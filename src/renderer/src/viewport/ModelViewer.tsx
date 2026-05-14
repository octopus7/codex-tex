import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Bounds, Center, Environment, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { useTextureToolStore } from '../store'

export interface ViewportCameraState {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
  fov: number
  zoom: number
}

export interface ModelViewerHandle {
  getTextureDataUrl: () => string | null
  getProjectionViewDataUrl: () => string | null
  getViewportState: () => ViewportCameraState | null
  bakeProjectionMask: (onProgress?: (progress: ProjectionBakeProgress) => void) => Promise<boolean>
  resetProjectionMask: () => void
}

export interface ProjectionBakeProgress {
  completed: number
  total: number
  ratio: number
  hits: number
  elapsedMs: number
  remainingMs: number | null
}

interface ModelViewerProps {
  projectionWindow?: boolean
  initialViewState?: ViewportCameraState | null
  projectionLocked?: boolean
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

interface ProjectionImagePoint {
  x: number
  y: number
  projectionRect: DOMRectLike
  coveredRect: DOMRectLike
}

interface DOMRectLike {
  x: number
  y: number
  width: number
  height: number
}

interface AlphaBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface ProjectionUvBuffer {
  width: number
  height: number
  data: Uint8Array
}

const DEFAULT_TEXTURE_SIZE = 1024
const PROJECTION_CAPTURE_SIZE = 2048

function createEditableTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true

  return texture
}

async function decodeTextureDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()

  return createImageBitmap(blob)
}

export const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(function ModelViewer(
  { projectionWindow = false, initialViewState = null, projectionLocked = false },
  ref
): ReactElement {
  const textureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const baseTextureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const workViewportRef = useRef<HTMLDivElement | null>(null)
  const projectionImageRef = useRef<HTMLImageElement | null>(null)
  const projectionMaskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const projectionMaskContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const projectionPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const projectionSamplerRef = useRef<HTMLCanvasElement | null>(null)
  const projectionContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const projectionImageDataRef = useRef<ImageData | null>(null)
  const projectionCameraRef = useRef<THREE.Camera | null>(null)
  const projectionObjectRef = useRef<THREE.Object3D | null>(null)
  const projectionRendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const projectionSceneRef = useRef<THREE.Scene | null>(null)
  const projectionUvBufferRef = useRef<ProjectionUvBuffer | null>(null)
  const viewportCameraStateRef = useRef<ViewportCameraState | null>(initialViewState)
  const raycasterRef = useRef(new THREE.Raycaster())
  const drawingRef = useRef(false)
  const strokeChangedRef = useRef(false)
  const lastUvUpdateAtRef = useRef(0)
  const pendingLastUvRef = useRef<string | null>(null)
  const statusUpdateAtRef = useRef(0)
  const [textureRevision, setTextureRevision] = useState(0)
  const model = useTextureToolStore((state) => state.model)
  const texture = useTextureToolStore((state) => state.texture)
  const projectionImage = useTextureToolStore((state) => state.projectionImage)
  const mode = useTextureToolStore((state) => state.mode)
  const brushColor = useTextureToolStore((state) => state.brushColor)
  const brushSize = useTextureToolStore((state) => state.brushSize)
  const brushStrength = useTextureToolStore((state) => state.brushStrength)
  const brushHardness = useTextureToolStore((state) => state.brushHardness)
  const projectionOpacity = useTextureToolStore((state) => state.projectionOpacity)
  const setTextureResolution = useTextureToolStore((state) => state.setTextureResolution)
  const setLastUv = useTextureToolStore((state) => state.setLastUv)
  const setStatus = useTextureToolStore((state) => state.setStatus)

  const [editableTexture, setEditableTexture] = useState(() => {
    const canvas = document.createElement('canvas')
    const baseCanvas = document.createElement('canvas')
    canvas.width = DEFAULT_TEXTURE_SIZE
    canvas.height = DEFAULT_TEXTURE_SIZE
    baseCanvas.width = DEFAULT_TEXTURE_SIZE
    baseCanvas.height = DEFAULT_TEXTURE_SIZE
    textureCanvasRef.current = canvas
    baseTextureCanvasRef.current = baseCanvas
    drawFallbackTexture(canvas)
    drawFallbackTexture(baseCanvas)

    const nextTexture = createEditableTexture(canvas)
    textureRef.current = nextTexture

    return nextTexture
  })

  useImperativeHandle(ref, () => ({
    getTextureDataUrl: () => textureCanvasRef.current?.toDataURL('image/png') ?? null,
    getProjectionViewDataUrl: () => captureProjectionView(),
    getViewportState: () => cloneViewportCameraState(viewportCameraStateRef.current),
    bakeProjectionMask: (onProgress) => bakeProjectionMask(onProgress),
    resetProjectionMask: () => resetProjectionMask()
  }))

  useEffect(() => {
    let alive = true

    async function loadTextureImage(dataUrl: string): Promise<void> {
      try {
        const image = await decodeTextureDataUrl(dataUrl)
        if (!alive || !textureCanvasRef.current || !textureRef.current) {
          return
        }

        const canvas = textureCanvasRef.current
        const baseCanvas = baseTextureCanvasRef.current
        if (!baseCanvas) {
          return
        }

        canvas.width = image.width
        canvas.height = image.height
        baseCanvas.width = image.width
        baseCanvas.height = image.height

        const context = canvas.getContext('2d')
        const baseContext = baseCanvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        baseContext?.clearRect(0, 0, baseCanvas.width, baseCanvas.height)
        context?.drawImage(image, 0, 0)
        baseContext?.drawImage(image, 0, 0)
        image.close()
        uploadEditableTexture(true)
        setTextureResolution(`${canvas.width} x ${canvas.height}`)
        setStatus(`Applied ${texture?.name ?? 'albedo texture'} (${canvas.width} x ${canvas.height})`)
      } catch {
        if (alive) {
          setStatus('The selected albedo texture could not be decoded.')
        }
      }
    }

    if (texture?.dataUrl) {
      void loadTextureImage(texture.dataUrl)
    }

    return () => {
      alive = false
    }
  }, [setStatus, setTextureResolution, texture?.dataUrl, texture?.name])

  useEffect(() => {
    const canvas = textureCanvasRef.current
    const baseCanvas = baseTextureCanvasRef.current
    if (!texture && canvas) {
      canvas.width = DEFAULT_TEXTURE_SIZE
      canvas.height = DEFAULT_TEXTURE_SIZE
      if (baseCanvas) {
        baseCanvas.width = DEFAULT_TEXTURE_SIZE
        baseCanvas.height = DEFAULT_TEXTURE_SIZE
        drawFallbackTexture(baseCanvas)
      }
      drawFallbackTexture(canvas)
      uploadEditableTexture(true)
      setTextureResolution(`${DEFAULT_TEXTURE_SIZE} x ${DEFAULT_TEXTURE_SIZE}`)
    }
  }, [setTextureResolution, texture])

  useEffect(() => {
    let alive = true

    if (!projectionImage?.dataUrl) {
      projectionImageRef.current = null
      projectionMaskContextRef.current = null
      projectionMaskCanvasRef.current = null
      projectionContextRef.current = null
      projectionImageDataRef.current = null
      projectionUvBufferRef.current = null
      clearProjectionPreview()
      return
    }

    const image = new window.Image()
    image.onload = () => {
      if (!alive) {
        return
      }

      const sampler = projectionSamplerRef.current ?? document.createElement('canvas')
      sampler.width = image.naturalWidth
      sampler.height = image.naturalHeight
      projectionSamplerRef.current = sampler

      const context = sampler.getContext('2d', { willReadFrequently: true })
      context?.clearRect(0, 0, sampler.width, sampler.height)
      context?.drawImage(image, 0, 0)

      projectionImageRef.current = image
      projectionContextRef.current = context
      projectionImageDataRef.current = context?.getImageData(0, 0, sampler.width, sampler.height) ?? null
      resetProjectionMask()
    }
    image.src = projectionImage.dataUrl

    return () => {
      alive = false
    }
  }, [projectionImage?.dataUrl])

  useEffect(() => {
    function finishStroke(): void {
      drawingRef.current = false
      strokeChangedRef.current = false
      flushPendingLastUv()
    }

    window.addEventListener('pointerup', finishStroke)
    return () => window.removeEventListener('pointerup', finishStroke)
  }, [setLastUv])

  function updateViewportCameraState(nextState: ViewportCameraState): void {
    viewportCameraStateRef.current = cloneViewportCameraState(nextState)
  }

  function paintFromEvent(event: ThreeEvent<PointerEvent>): void {
    if (mode === 'orbit') {
      return
    }

    if (!event.uv) {
      reportStatus('The selected mesh has no UV at the pointer hit.')
      return
    }

    event.stopPropagation()

    if (mode === 'projectionPaint') {
      paintProjectionFromEvent(event, event.uv)
      return
    }

    if (mode === 'erase') {
      restoreBaseAtUv(event.uv, brushStrength, brushSize / 2, brushHardness)
    } else {
      drawDabAtUv({
        uv: event.uv,
        color: hexToRgba(brushColor),
        strength: brushStrength,
        radius: brushSize / 2,
        hardness: brushHardness
      })
    }
    uploadEditableTexture()
    strokeChangedRef.current = true
    reportLastUv(event.uv)
  }

  function paintProjectionFromEvent(event: ThreeEvent<PointerEvent>, centerUv: THREE.Vector2): void {
    const viewport = workViewportRef.current
    const image = projectionImageRef.current
    const projectionContext = projectionContextRef.current

    if (!viewport || !image || !projectionContext) {
      reportStatus('Load a projection image before using Projection Paint.')
      return
    }

    const rect = viewport.getBoundingClientRect()
    const centerX = event.nativeEvent.clientX
    const centerY = event.nativeEvent.clientY
    const radius = brushSize / 2
    const sampleStep = getProjectionSampleStep(radius)
    const stampRadius = estimateProjectionStampRadius(
      centerX,
      centerY,
      rect,
      event.camera,
      event.eventObject,
      centerUv,
      sampleStep
    )
    let hits = 0

    for (let y = -radius, rowIndex = 0; y <= radius; y += sampleStep, rowIndex += 1) {
      const stagger = rowIndex % 2 === 0 ? 0 : sampleStep * 0.5
      for (let x = -radius + stagger; x <= radius; x += sampleStep) {
        const distance = Math.hypot(x, y)
        if (distance > radius) {
          continue
        }

        const clientX = centerX + x
        const clientY = centerY + y
        const falloff = brushFalloff(distance / radius, brushHardness)
        const projectedColor = sampleProjectionColor(clientX, clientY, rect)
        if (!projectedColor || projectedColor.a <= 0) {
          continue
        }

        const uv = raycastUvFromClient(clientX, clientY, rect, event.camera, event.eventObject)
        if (!uv) {
          continue
        }

        drawDabAtUv({
          uv,
          color: projectedColor,
          strength: brushStrength * falloff * projectedColor.a,
          radius: stampRadius,
          hardness: 0.15
        })
        hits += 1
      }
    }

    if (hits === 0) {
      reportStatus('Projection Paint did not hit visible UVs under the brush.')
      return
    }

    uploadEditableTexture()
    strokeChangedRef.current = true
    reportLastUv(centerUv)
  }

  function estimateProjectionStampRadius(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    camera: THREE.Camera,
    target: THREE.Object3D,
    centerUv: THREE.Vector2,
    sampleStep: number
  ): number {
    const canvas = textureCanvasRef.current
    if (!canvas) {
      return Math.max(2, sampleStep)
    }

    const offsets = [
      [sampleStep, 0],
      [-sampleStep, 0],
      [0, sampleStep],
      [0, -sampleStep]
    ]
    let maxDistance = 0

    for (const [offsetX, offsetY] of offsets) {
      const uv = raycastUvFromClient(clientX + offsetX, clientY + offsetY, rect, camera, target)
      if (!uv) {
        continue
      }

      const deltaX = (uv.x - centerUv.x) * canvas.width
      const deltaY = (uv.y - centerUv.y) * canvas.height
      const distance = Math.hypot(deltaX, deltaY)
      if (Number.isFinite(distance)) {
        maxDistance = Math.max(maxDistance, distance)
      }
    }

    return clamp(maxDistance * 1.2, 3, 24)
  }

  function sampleProjectionColor(clientX: number, clientY: number, rect: DOMRect): RgbaColor | null {
    const image = projectionImageRef.current
    const imageData = projectionImageDataRef.current
    if (!image || !imageData) {
      return null
    }

    const projectionRect = getProjectionOverlayRect(rect.width, rect.height)
    const localElementX = clientX - rect.left - projectionRect.x
    const localElementY = clientY - rect.top - projectionRect.y

    if (
      localElementX < 0 ||
      localElementY < 0 ||
      localElementX > projectionRect.width ||
      localElementY > projectionRect.height
    ) {
      return null
    }

    const covered = getCoveredImageRect(
      image.naturalWidth,
      image.naturalHeight,
      projectionRect.width,
      projectionRect.height
    )
    const localImageX = localElementX - covered.x
    const localImageY = localElementY - covered.y
    const sourceX = clamp(Math.floor((localImageX / covered.width) * image.naturalWidth), 0, image.naturalWidth - 1)
    const sourceY = clamp(Math.floor((localImageY / covered.height) * image.naturalHeight), 0, image.naturalHeight - 1)
    const pixelOffset = (sourceY * imageData.width + sourceX) * 4
    const pixel = imageData.data

    return {
      r: pixel[pixelOffset],
      g: pixel[pixelOffset + 1],
      b: pixel[pixelOffset + 2],
      a: pixel[pixelOffset + 3] / 255
    }
  }

  function raycastUvFromClient(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    camera: THREE.Camera,
    target: THREE.Object3D
  ): THREE.Vector2 | null {
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = raycasterRef.current
    raycaster.setFromCamera(pointer, camera)

    const intersections = raycaster.intersectObject(target, true)
    const hit = intersections.find((entry) => entry.uv)

    return hit?.uv?.clone() ?? null
  }

  function drawDabAtUv({
    uv,
    color,
    strength,
    radius,
    hardness
  }: {
    uv: THREE.Vector2
    color: RgbaColor
    strength: number
    radius: number
    hardness: number
  }): void {
    const canvas = textureCanvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const x = uv.x * canvas.width
    const y = (1 - uv.y) * canvas.height
    const alpha = clamp(strength, 0, 1)
    const brushRadius = Math.max(0.5, radius)

    context.save()
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = createBrushFill(context, x, y, brushRadius, color, alpha, hardness)
    context.beginPath()
    context.arc(x, y, brushRadius, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }

  function restoreBaseAtUv(uv: THREE.Vector2, strength: number, radius: number, hardness: number): void {
    const canvas = textureCanvasRef.current
    const baseCanvas = baseTextureCanvasRef.current
    if (!canvas || !baseCanvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const x = uv.x * canvas.width
    const y = (1 - uv.y) * canvas.height
    const brushRadius = Math.max(0.5, radius)
    const left = Math.max(0, Math.floor(x - brushRadius))
    const top = Math.max(0, Math.floor(y - brushRadius))
    const right = Math.min(canvas.width, Math.ceil(x + brushRadius))
    const bottom = Math.min(canvas.height, Math.ceil(y + brushRadius))
    const width = Math.max(1, right - left)
    const height = Math.max(1, bottom - top)
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = width
    tempCanvas.height = height

    const tempContext = tempCanvas.getContext('2d')
    if (!tempContext) {
      return
    }

    tempContext.drawImage(baseCanvas, left, top, width, height, 0, 0, width, height)
    tempContext.globalCompositeOperation = 'destination-in'
    tempContext.fillStyle = createBrushFill(
      tempContext,
      x - left,
      y - top,
      brushRadius,
      { r: 0, g: 0, b: 0, a: 1 },
      clamp(strength, 0, 1),
      hardness
    )
    tempContext.beginPath()
    tempContext.arc(x - left, y - top, brushRadius, 0, Math.PI * 2)
    tempContext.fill()

    context.drawImage(tempCanvas, left, top)
  }

  function uploadEditableTexture(rebuild = false): void {
    const canvas = textureCanvasRef.current
    const textureMap = textureRef.current
    if (!canvas || !textureMap) {
      return
    }

    if (rebuild) {
      const nextTexture = createEditableTexture(canvas)
      textureMap.dispose()
      textureRef.current = nextTexture
      setEditableTexture(nextTexture)
      setTextureRevision((revision) => revision + 1)
      return
    }

    textureMap.source.data = canvas
    textureMap.colorSpace = THREE.SRGBColorSpace
    textureMap.flipY = true
    textureMap.needsUpdate = true
  }

  function publishEditedTexture(): void {
    const canvas = textureCanvasRef.current
    if (!canvas || !texture) {
      return
    }

    window.textureTool.publishTextureUpdate({
      ...texture,
      dataUrl: canvas.toDataURL('image/png')
    })
  }

  function resetProjectionMask(): void {
    const image = projectionImageRef.current
    if (!image) {
      clearProjectionPreview()
      return
    }

    const maskCanvas = projectionMaskCanvasRef.current ?? document.createElement('canvas')
    maskCanvas.width = image.naturalWidth
    maskCanvas.height = image.naturalHeight
    projectionMaskCanvasRef.current = maskCanvas
    projectionMaskContextRef.current = maskCanvas.getContext('2d', { willReadFrequently: true })
    projectionMaskContextRef.current?.clearRect(0, 0, maskCanvas.width, maskCanvas.height)

    const previewCanvas = projectionPreviewCanvasRef.current
    if (previewCanvas) {
      previewCanvas.width = image.naturalWidth
      previewCanvas.height = image.naturalHeight
    }

    renderProjectionMaskPreview()
  }

  function clearProjectionPreview(): void {
    const previewCanvas = projectionPreviewCanvasRef.current
    const previewContext = previewCanvas?.getContext('2d')
    if (!previewCanvas || !previewContext) {
      return
    }

    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
  }

  function handleProjectionMaskPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!canEditProjectionMask()) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    strokeChangedRef.current = false
    paintProjectionMaskFromPointer(event)
  }

  function handleProjectionMaskPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current || !canEditProjectionMask()) {
      return
    }

    event.preventDefault()
    paintProjectionMaskFromPointer(event)
  }

  function canEditProjectionMask(): boolean {
    return projectionWindow && (mode === 'projectionPaint' || mode === 'erase') && Boolean(projectionImageRef.current)
  }

  function paintProjectionMaskFromPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const imagePoint = getProjectionImagePointFromClient(event.clientX, event.clientY)
    const context = projectionMaskContextRef.current
    const image = projectionImageRef.current
    if (!imagePoint || !context || !image) {
      return
    }

    const radius = Math.max(0.5, (brushSize / 2) * (image.naturalWidth / imagePoint.coveredRect.width))
    const alpha = clamp(brushStrength, 0, 1)

    context.save()
    context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    context.fillStyle = createBrushFill(
      context,
      imagePoint.x,
      imagePoint.y,
      radius,
      { r: 255, g: 255, b: 255, a: 1 },
      alpha,
      brushHardness
    )
    context.beginPath()
    context.arc(imagePoint.x, imagePoint.y, radius, 0, Math.PI * 2)
    context.fill()
    context.restore()

    strokeChangedRef.current = true
    renderProjectionMaskPreview()
  }

  function renderProjectionMaskPreview(): void {
    const image = projectionImageRef.current
    const maskCanvas = projectionMaskCanvasRef.current
    const previewCanvas = projectionPreviewCanvasRef.current
    if (!image || !maskCanvas || !previewCanvas) {
      return
    }

    if (previewCanvas.width !== image.naturalWidth || previewCanvas.height !== image.naturalHeight) {
      previewCanvas.width = image.naturalWidth
      previewCanvas.height = image.naturalHeight
    }

    const context = previewCanvas.getContext('2d')
    if (!context) {
      return
    }

    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
    context.globalCompositeOperation = 'source-over'
    context.drawImage(image, 0, 0, previewCanvas.width, previewCanvas.height)
    context.globalCompositeOperation = 'destination-in'
    context.drawImage(maskCanvas, 0, 0, previewCanvas.width, previewCanvas.height)
    context.globalCompositeOperation = 'source-over'
  }

  function getProjectionUvBuffer(width: number, height: number): ProjectionUvBuffer | null {
    const current = projectionUvBufferRef.current
    if (current && current.width === width && current.height === height) {
      return current
    }

    const nextBuffer = renderProjectionUvBuffer(width, height)
    projectionUvBufferRef.current = nextBuffer

    return nextBuffer
  }

  function renderProjectionUvBuffer(width: number, height: number): ProjectionUvBuffer | null {
    const renderer = projectionRendererRef.current
    const scene = projectionSceneRef.current
    const camera = projectionCameraRef.current
    const targetObject = projectionObjectRef.current
    if (!renderer || !scene || !camera || !targetObject) {
      return null
    }

    const uvMaterial = createUvEncodeMaterial()
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType
    })
    const pixels = new Uint8Array(width * height * 4)
    const objectStates: Array<{
      object: THREE.Object3D
      visible: boolean
      material?: THREE.Material | THREE.Material[]
    }> = []
    const previousTarget = renderer.getRenderTarget()
    const previousClearColor = new THREE.Color()
    renderer.getClearColor(previousClearColor)
    const previousClearAlpha = renderer.getClearAlpha()
    const previousAutoClear = renderer.autoClear
    const previousBackground = scene.background

    scene.traverse((object) => {
      const insideTarget = isDescendantOf(object, targetObject)
      const targetInsideObject = isDescendantOf(targetObject, object)
      if (!insideTarget && !targetInsideObject) {
        objectStates.push({ object, visible: object.visible })
        object.visible = false
        return
      }

      if (targetInsideObject && object !== targetObject) {
        objectStates.push({ object, visible: object.visible })
        object.visible = true
        return
      }

      if (!(object instanceof THREE.Mesh)) {
        return
      }

      objectStates.push({ object, visible: object.visible, material: object.material })
      if (object.geometry.getAttribute('uv')) {
        object.visible = true
        object.material = uvMaterial
      } else {
        object.visible = false
      }
    })

    try {
      scene.background = null
      renderer.autoClear = true
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(renderTarget)
      renderer.clear(true, true, true)
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
    } finally {
      objectStates.forEach((state) => {
        state.object.visible = state.visible
        if (state.material && state.object instanceof THREE.Mesh) {
          state.object.material = state.material
        }
      })
      scene.background = previousBackground
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(previousClearColor, previousClearAlpha)
      renderer.autoClear = previousAutoClear
      uvMaterial.dispose()
      renderTarget.dispose()
    }

    return { width, height, data: pixels }
  }

  function sampleProjectionUvBuffer(buffer: ProjectionUvBuffer, x: number, y: number): THREE.Vector2 | null {
    const sourceX = clamp(Math.floor(x), 0, buffer.width - 1)
    const sourceY = clamp(Math.floor(y), 0, buffer.height - 1)
    const flippedY = buffer.height - 1 - sourceY
    const offset = (flippedY * buffer.width + sourceX) * 4
    const r = buffer.data[offset]
    const g = buffer.data[offset + 1]
    const b = buffer.data[offset + 2]
    const a = buffer.data[offset + 3]

    if (r === 0 && g === 0 && b === 0 && a === 0) {
      return null
    }

    const u = ((r * 256 + g) / 65535)
    const v = ((b * 256 + a) / 65535)

    return new THREE.Vector2(u, v)
  }

  async function bakeProjectionMask(onProgress?: (progress: ProjectionBakeProgress) => void): Promise<boolean> {
    const viewport = workViewportRef.current
    const image = projectionImageRef.current
    const imageData = projectionImageDataRef.current
    const maskCanvas = projectionMaskCanvasRef.current
    const maskContext = projectionMaskContextRef.current
    const textureCanvas = textureCanvasRef.current

    if (!viewport || !image || !imageData || !maskCanvas || !maskContext || !textureCanvas) {
      reportStatus('Reload a projection image before baking.')
      return false
    }

    const uvBuffer = getProjectionUvBuffer(maskCanvas.width, maskCanvas.height)
    if (!uvBuffer) {
      reportStatus('Projection UV buffer could not be prepared.')
      return false
    }

    const maskData = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const bounds = getAlphaBounds(maskData.data, maskCanvas.width, maskCanvas.height)
    if (!bounds) {
      reportStatus('Paint a projection mask before baking.')
      return false
    }

    const step = getProjectionBakeSampleStep(maskCanvas.width, maskCanvas.height)
    const stampRadius = getProjectionBakeStampRadius(textureCanvas.width, textureCanvas.height, maskCanvas.width, step)
    const columnCount = Math.floor((bounds.right - bounds.left) / step) + 1
    const rowCount = Math.floor((bounds.bottom - bounds.top) / step) + 1
    const total = Math.max(1, columnCount * rowCount)
    const startedAt = performance.now()
    let completed = 0
    let hits = 0
    let lastProgressAt = 0

    const reportBakeProgress = (force = false): void => {
      const now = performance.now()
      if (!force && now - lastProgressAt < 100) {
        return
      }

      const elapsedMs = now - startedAt
      const ratio = clamp(completed / total, 0, 1)
      const remainingMs = ratio > 0 ? (elapsedMs / ratio) * (1 - ratio) : null
      lastProgressAt = now
      onProgress?.({
        completed,
        total,
        ratio,
        hits,
        elapsedMs,
        remainingMs
      })
    }

    reportBakeProgress(true)

    let rowsProcessed = 0
    for (let y = bounds.top; y <= bounds.bottom; y += step) {
      for (let x = bounds.left; x <= bounds.right; x += step) {
        completed += 1
        const pixelOffset = (y * maskData.width + x) * 4
        const maskAlpha = maskData.data[pixelOffset + 3] / 255
        if (maskAlpha <= 0.01) {
          reportBakeProgress()
          continue
        }

        const imageOffset = (y * imageData.width + x) * 4
        const projectedColor = {
          r: imageData.data[imageOffset],
          g: imageData.data[imageOffset + 1],
          b: imageData.data[imageOffset + 2],
          a: imageData.data[imageOffset + 3] / 255
        }

        if (projectedColor.a <= 0) {
          reportBakeProgress()
          continue
        }

        const uv = sampleProjectionUvBuffer(uvBuffer, x, y)
        if (!uv) {
          reportBakeProgress()
          continue
        }

        drawDabAtUv({
          uv,
          color: projectedColor,
          strength: maskAlpha * projectedColor.a,
          radius: stampRadius,
          hardness: 0.2
        })
        hits += 1
        reportBakeProgress()
      }

      rowsProcessed += 1
      if (rowsProcessed % 4 === 0 || performance.now() - lastProgressAt >= 100) {
        reportBakeProgress(true)
        await waitForAnimationFrame()
      }
    }

    if (hits === 0) {
      reportBakeProgress(true)
      reportStatus('Projection bake did not hit visible UVs under the mask.')
      return false
    }

    uploadEditableTexture()
    publishEditedTexture()
    resetProjectionMask()
    completed = total
    reportBakeProgress(true)
    reportStatus(`Baked projection mask with ${hits} samples.`)

    return true
  }

  function getProjectionImagePointFromClient(clientX: number, clientY: number): ProjectionImagePoint | null {
    const viewport = workViewportRef.current
    const image = projectionImageRef.current
    if (!viewport || !image) {
      return null
    }

    const rect = viewport.getBoundingClientRect()
    const projectionRect = getProjectionOverlayRect(rect.width, rect.height)
    const coveredRect = getCoveredImageRect(image.naturalWidth, image.naturalHeight, projectionRect.width, projectionRect.height)
    const localElementX = clientX - rect.left - projectionRect.x
    const localElementY = clientY - rect.top - projectionRect.y
    const localImageX = localElementX - coveredRect.x
    const localImageY = localElementY - coveredRect.y

    if (
      localImageX < 0 ||
      localImageY < 0 ||
      localImageX > coveredRect.width ||
      localImageY > coveredRect.height
    ) {
      return null
    }

    return {
      x: clamp((localImageX / coveredRect.width) * image.naturalWidth, 0, image.naturalWidth - 1),
      y: clamp((localImageY / coveredRect.height) * image.naturalHeight, 0, image.naturalHeight - 1),
      projectionRect,
      coveredRect
    }
  }

  function reportLastUv(uv: THREE.Vector2): void {
    pendingLastUvRef.current = `${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}`

    const now = performance.now()
    if (now - lastUvUpdateAtRef.current < 80) {
      return
    }

    flushPendingLastUv(now)
  }

  function flushPendingLastUv(now = performance.now()): void {
    if (!pendingLastUvRef.current) {
      return
    }

    setLastUv(pendingLastUvRef.current)
    pendingLastUvRef.current = null
    lastUvUpdateAtRef.current = now
  }

  function reportStatus(message: string): void {
    const now = performance.now()
    if (now - statusUpdateAtRef.current < 300) {
      return
    }

    statusUpdateAtRef.current = now
    setStatus(message)
  }

  function captureProjectionView(): string | null {
    const viewport = workViewportRef.current
    const sourceCanvas = viewport?.querySelector('canvas')
    if (!viewport || !sourceCanvas) {
      return null
    }

    const output = document.createElement('canvas')
    output.width = PROJECTION_CAPTURE_SIZE
    output.height = PROJECTION_CAPTURE_SIZE
    const context = output.getContext('2d')
    if (!context) {
      return null
    }

    const crop = getCenteredSquareCrop(sourceCanvas.width, sourceCanvas.height)
    context.fillStyle = '#e9e6dc'
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(
      sourceCanvas,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      output.width,
      output.height
    )

    return output.toDataURL('image/png')
  }

  const paintableFromMainViewport = mode === 'paint' || mode === 'erase'
  const projectionMaskEditable =
    projectionWindow && !projectionLocked && (mode === 'projectionPaint' || mode === 'erase') && Boolean(projectionImage)

  if (projectionWindow) {
    return (
      <div className="projection-square-viewport">
        <div className="viewport-wrap" ref={workViewportRef}>
          <ViewportLabel title="Projection View" subtitle="Fixed" />
          <ViewportScene
            modelContent={model?.content ?? null}
            texture={editableTexture}
            textureRevision={textureRevision}
            controlsEnabled={false}
            fitToBounds={false}
            initialViewState={initialViewState}
            onViewStateChange={updateViewportCameraState}
            onCameraReady={(camera) => {
              projectionCameraRef.current = camera
              projectionUvBufferRef.current = null
            }}
            onObjectReady={(object) => {
              projectionObjectRef.current = object
              projectionUvBufferRef.current = null
            }}
            onRenderContextReady={(renderer, scene) => {
              projectionRendererRef.current = renderer
              projectionSceneRef.current = scene
              projectionUvBufferRef.current = null
            }}
          />
          {projectionImage && (
            <>
              <img
                className="projection-overlay projection-guide"
                src={projectionImage.dataUrl}
                alt=""
                style={{ opacity: projectionOpacity }}
                draggable={false}
              />
              <canvas
                ref={projectionPreviewCanvasRef}
                className={projectionMaskEditable ? 'projection-mask-preview active' : 'projection-mask-preview'}
                onPointerDown={handleProjectionMaskPointerDown}
                onPointerMove={handleProjectionMaskPointerMove}
                onContextMenu={(event) => event.preventDefault()}
              />
            </>
          )}
          {!model && <EmptyOverlay title="No OBJ loaded" body="Load an OBJ in the main window first." />}
        </div>
      </div>
    )
  }

  return (
    <div className="viewport-single">
      <div className="viewport-wrap">
        <ViewportLabel title="Result View" subtitle="Final texture" />
        <ViewportScene
          modelContent={model?.content ?? null}
          texture={editableTexture}
          textureRevision={textureRevision}
          controlsEnabled={!paintableFromMainViewport}
          fitToBounds
          onViewStateChange={updateViewportCameraState}
          onPointerDown={
            paintableFromMainViewport
              ? (event) => {
                  drawingRef.current = true
                  paintFromEvent(event)
                }
              : undefined
          }
          onPointerMove={
            paintableFromMainViewport
              ? (event) => {
                  if (drawingRef.current) {
                    paintFromEvent(event)
                  }
                }
              : undefined
          }
          onMissingUv={() => setStatus('The selected mesh has no UV at the pointer hit.')}
        />
        {!model && <EmptyOverlay title="No result yet" body="The final view updates after an OBJ is loaded." />}
      </div>
    </div>
  )
})

interface ViewportSceneProps {
  modelContent: string | null
  texture: THREE.Texture
  textureRevision: number
  controlsEnabled: boolean
  fitToBounds?: boolean
  initialViewState?: ViewportCameraState | null
  onViewStateChange?: (state: ViewportCameraState) => void
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void
  onMissingUv?: () => void
  onCameraReady?: (camera: THREE.Camera) => void
  onObjectReady?: (object: THREE.Object3D | null) => void
  onRenderContextReady?: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => void
}

function ViewportScene({
  modelContent,
  texture,
  textureRevision,
  controlsEnabled,
  fitToBounds = true,
  initialViewState = null,
  onViewStateChange,
  onPointerDown,
  onPointerMove,
  onMissingUv,
  onCameraReady,
  onObjectReady,
  onRenderContextReady
}: ViewportSceneProps): ReactElement {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 4], fov: 45, near: 0.01, far: 1000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#e9e6dc']} />
      <CameraStateController
        controlsEnabled={controlsEnabled}
        initialViewState={initialViewState}
        onViewStateChange={onViewStateChange}
        onCameraReady={onCameraReady}
        onRenderContextReady={onRenderContextReady}
      />
      <Suspense fallback={null}>
        <Environment preset="studio" />
        {modelContent && fitToBounds ? (
          <Bounds fit clip observe margin={1.15} maxDuration={0.0001} interpolateFunc={() => 1}>
            <Center>
              <LoadedObj
                objContent={modelContent}
                texture={texture}
                textureRevision={textureRevision}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onMissingUv={onMissingUv}
                onObjectReady={onObjectReady}
              />
            </Center>
          </Bounds>
        ) : modelContent ? (
          <Center>
            <LoadedObj
              objContent={modelContent}
              texture={texture}
              textureRevision={textureRevision}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onMissingUv={onMissingUv}
              onObjectReady={onObjectReady}
            />
          </Center>
        ) : (
          <EmptyScene />
        )}
      </Suspense>
      <Grid
        position={[0, -1.2, 0]}
        args={[7, 7]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#b7b0a3"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#8a8172"
        fadeDistance={9}
        fadeStrength={1}
      />
    </Canvas>
  )
}

function CameraStateController({
  controlsEnabled,
  initialViewState,
  onViewStateChange,
  onCameraReady,
  onRenderContextReady
}: {
  controlsEnabled: boolean
  initialViewState: ViewportCameraState | null
  onViewStateChange?: (state: ViewportCameraState) => void
  onCameraReady?: (camera: THREE.Camera) => void
  onRenderContextReady?: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => void
}): ReactElement | null {
  const { camera, gl, scene } = useThree()
  const controlsRef = useRef<any>(null)
  const fallbackTargetRef = useRef(new THREE.Vector3(0, 0, 0))
  const appliedStateRef = useRef<string | null>(null)
  const lastReportAtRef = useRef(0)

  useEffect(() => {
    onCameraReady?.(camera)
  }, [camera, onCameraReady])

  useEffect(() => {
    onRenderContextReady?.(gl, scene)
  }, [gl, scene, onRenderContextReady])

  useLayoutEffect(() => {
    if (!initialViewState) {
      return
    }

    const signature = serializeViewportCameraState(initialViewState)
    if (appliedStateRef.current === signature) {
      return
    }

    applyViewportCameraState(camera, initialViewState)
    fallbackTargetRef.current.set(...initialViewState.target)

    if (controlsRef.current?.target) {
      controlsRef.current.target.set(...initialViewState.target)
      controlsRef.current.update()
    }

    appliedStateRef.current = signature
    onViewStateChange?.(readViewportCameraState(camera, controlsRef.current?.target ?? fallbackTargetRef.current))
  }, [camera, initialViewState, onViewStateChange])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || !onViewStateChange) {
      return
    }

    const handleChange = (): void => {
      fallbackTargetRef.current.copy(controls.target)
      onViewStateChange(readViewportCameraState(camera, controls.target))
    }

    controls.addEventListener('change', handleChange)
    handleChange()

    return () => controls.removeEventListener('change', handleChange)
  }, [camera, onViewStateChange])

  useFrame(() => {
    if (!onViewStateChange) {
      return
    }

    const now = performance.now()
    if (now - lastReportAtRef.current < 120) {
      return
    }

    lastReportAtRef.current = now
    onViewStateChange(readViewportCameraState(camera, controlsRef.current?.target ?? fallbackTargetRef.current))
  })

  return controlsEnabled ? <OrbitControls ref={controlsRef} makeDefault enableDamping={false} /> : null
}

interface LoadedObjProps {
  objContent: string
  texture: THREE.Texture
  textureRevision: number
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void
  onMissingUv?: () => void
  onObjectReady?: (object: THREE.Object3D | null) => void
}

function LoadedObj({
  objContent,
  texture,
  textureRevision,
  onPointerDown,
  onPointerMove,
  onMissingUv,
  onObjectReady
}: LoadedObjProps): ReactElement {
  const object = useMemo(() => {
    const parsed = new OBJLoader().parse(objContent)
    parsed.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return
      }

      child.geometry.computeBoundingBox()
      child.geometry.computeBoundingSphere()
      child.castShadow = true
      child.receiveShadow = true
      child.material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide
      })
    })

    return parsed
  }, [objContent, texture])

  useEffect(() => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return
      }

      const material = child.material
      if (Array.isArray(material)) {
        material.forEach((entry) => {
          if (entry instanceof THREE.MeshBasicMaterial) {
            entry.map = texture
            entry.needsUpdate = true
          }
        })
      } else if (material instanceof THREE.MeshBasicMaterial) {
        material.map = texture
        material.needsUpdate = true
      }
    })
  }, [object, texture, textureRevision])

  useEffect(() => {
    onObjectReady?.(object)

    return () => {
      onObjectReady?.(null)
    }
  }, [object, onObjectReady])

  useEffect(() => {
    return () => {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const material = child.material
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose())
          } else {
            material.dispose()
          }
        }
      })
    }
  }, [object])

  function handlePointerDown(event: ThreeEvent<PointerEvent>): void {
    if (!event.uv) {
      onMissingUv?.()
    }
    onPointerDown?.(event)
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>): void {
    if (!event.uv) {
      return
    }
    onPointerMove?.(event)
  }

  return <primitive object={object} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} />
}

function ViewportLabel({ title, subtitle }: { title: string; subtitle: string }): ReactElement {
  return (
    <div className="viewport-label">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  )
}

function EmptyOverlay({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="viewport-empty">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

function EmptyScene(): ReactElement {
  return (
    <mesh rotation={[0.35, 0.72, 0]}>
      <boxGeometry args={[1.4, 1.4, 1.4]} />
      <meshStandardMaterial color="#b9c8bd" roughness={0.85} metalness={0.02} />
    </mesh>
  )
}

function drawFallbackTexture(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const size = 64
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = 0; x < canvas.width; x += size) {
      context.fillStyle = (x / size + y / size) % 2 === 0 ? '#d7d2c6' : '#aebcb2'
      context.fillRect(x, y, size, size)
    }
  }
}

function createBrushFill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: RgbaColor,
  alpha: number,
  hardness: number
): string | CanvasGradient {
  const brushAlpha = clamp(alpha, 0, 1) * color.a
  const brushHardness = clamp(hardness, 0, 1)

  if (brushHardness >= 0.99) {
    return rgbaToCss(color, brushAlpha)
  }

  const innerRadius = Math.max(0, radius * brushHardness)
  const gradient = context.createRadialGradient(x, y, innerRadius, x, y, radius)
  gradient.addColorStop(0, rgbaToCss(color, brushAlpha))
  gradient.addColorStop(1, rgbaToCss(color, 0))

  return gradient
}

function brushFalloff(normalizedDistance: number, hardness: number): number {
  const edge = clamp(normalizedDistance, 0, 1)
  const hardRegion = clamp(hardness, 0, 1)

  if (edge <= hardRegion || hardRegion >= 0.99) {
    return 1
  }

  const t = (edge - hardRegion) / (1 - hardRegion)
  const smooth = t * t * (3 - 2 * t)

  return 1 - smooth
}

function getProjectionSampleStep(radius: number): number {
  if (radius <= 18) {
    return 3
  }

  if (radius <= 45) {
    return 4
  }

  if (radius <= 75) {
    return 6
  }

  return 8
}

function getProjectionBakeSampleStep(width: number, height: number): number {
  const size = Math.max(width, height)

  if (size >= 2048) {
    return 4
  }

  if (size >= 1024) {
    return 3
  }

  return 2
}

function getProjectionBakeStampRadius(
  textureWidth: number,
  textureHeight: number,
  projectionWidth: number,
  sampleStep: number
): number {
  const textureSize = Math.max(textureWidth, textureHeight)

  return clamp((sampleStep / projectionWidth) * textureSize * 2, 1.5, 8)
}

function getAlphaBounds(data: Uint8ClampedArray, width: number, height: number): AlphaBounds | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha === 0) {
        continue
      }

      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (right < 0 || bottom < 0) {
    return null
  }

  return { left, top, right, bottom }
}

function createUvEncodeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;

      void main() {
        vec2 encodedUv = clamp(vUv, 0.0, 1.0) * 65535.0;
        vec2 high = floor(encodedUv / 256.0);
        vec2 low = floor(mod(encodedUv, 256.0));
        gl_FragColor = vec4(high.x / 255.0, low.x / 255.0, high.y / 255.0, low.y / 255.0);
      }
    `,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true
  })
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current === ancestor) {
      return true
    }
    current = current.parent
  }

  return false
}

function getCoveredImageRect(
  imageWidth: number,
  imageHeight: number,
  boundsWidth: number,
  boundsHeight: number
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(boundsWidth / imageWidth, boundsHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale

  return {
    x: (boundsWidth - width) / 2,
    y: (boundsHeight - height) / 2,
    width,
    height
  }
}

function getProjectionOverlayRect(
  boundsWidth: number,
  boundsHeight: number
): { x: number; y: number; width: number; height: number } {
  const size = Math.min(boundsWidth, boundsHeight)

  return {
    x: (boundsWidth - size) / 2,
    y: (boundsHeight - size) / 2,
    width: size,
    height: size
  }
}

function getCenteredSquareCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)

  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    size
  }
}

function readViewportCameraState(camera: THREE.Camera, target: THREE.Vector3): ViewportCameraState {
  return {
    position: vectorToTuple(camera.position),
    quaternion: quaternionToTuple(camera.quaternion),
    target: vectorToTuple(target),
    fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 45,
    zoom: getCameraZoom(camera)
  }
}

function applyViewportCameraState(camera: THREE.Camera, state: ViewportCameraState): void {
  camera.position.set(...state.position)
  camera.quaternion.set(...state.quaternion)

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = state.fov
    camera.zoom = state.zoom
    camera.updateProjectionMatrix()
  } else if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = state.zoom
    camera.updateProjectionMatrix()
  }

  camera.updateMatrixWorld()
}

function getCameraZoom(camera: THREE.Camera): number {
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
    return camera.zoom
  }

  return 1
}

function cloneViewportCameraState(state: ViewportCameraState | null): ViewportCameraState | null {
  if (!state) {
    return null
  }

  return {
    position: [...state.position],
    quaternion: [...state.quaternion],
    target: [...state.target],
    fov: state.fov,
    zoom: state.zoom
  }
}

function serializeViewportCameraState(state: ViewportCameraState): string {
  return [
    ...state.position,
    ...state.quaternion,
    ...state.target,
    state.fov,
    state.zoom
  ]
    .map((value) => value.toFixed(5))
    .join(',')
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function quaternionToTuple(quaternion: THREE.Quaternion): [number, number, number, number] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

function hexToRgba(hex: string): RgbaColor {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized.length === 3 ? expandShortHex(normalized) : normalized, 16)

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: 1
  }
}

function expandShortHex(value: string): string {
  return value
    .split('')
    .map((entry) => `${entry}${entry}`)
    .join('')
}

function rgbaToCss(color: RgbaColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
