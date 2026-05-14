import {
  type ReactElement,
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { Bounds, Center, Environment, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { useTextureToolStore } from '../store'

export interface ModelViewerHandle {
  getTextureDataUrl: () => string | null
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

const DEFAULT_TEXTURE_SIZE = 1024

export const ModelViewer = forwardRef<ModelViewerHandle>(function ModelViewer(_props, ref): ReactElement {
  const textureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const baseTextureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const workViewportRef = useRef<HTMLDivElement | null>(null)
  const projectionImageRef = useRef<HTMLImageElement | null>(null)
  const projectionSamplerRef = useRef<HTMLCanvasElement | null>(null)
  const projectionContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const drawingRef = useRef(false)
  const [, setTextureRevision] = useState(0)
  const {
    model,
    texture,
    projectionImage,
    mode,
    brushColor,
    brushSize,
    brushStrength,
    brushHardness,
    projectionOpacity,
    setTextureResolution,
    setLastUv,
    setStatus
  } = useTextureToolStore()

  const editableTexture = useMemo(() => {
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

    const nextTexture = new THREE.CanvasTexture(canvas)
    nextTexture.colorSpace = THREE.SRGBColorSpace
    nextTexture.flipY = true
    nextTexture.wrapS = THREE.RepeatWrapping
    nextTexture.wrapT = THREE.RepeatWrapping
    textureRef.current = nextTexture

    return nextTexture
  }, [])

  useImperativeHandle(ref, () => ({
    getTextureDataUrl: () => textureCanvasRef.current?.toDataURL('image/png') ?? null
  }))

  useEffect(() => {
    let alive = true

    async function loadTextureImage(dataUrl: string): Promise<void> {
      const image = new window.Image()
      image.onload = () => {
        if (!alive || !textureCanvasRef.current || !textureRef.current) {
          return
        }

        const canvas = textureCanvasRef.current
        const baseCanvas = baseTextureCanvasRef.current
        if (!baseCanvas) {
          return
        }

        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        baseCanvas.width = image.naturalWidth
        baseCanvas.height = image.naturalHeight

        const context = canvas.getContext('2d')
        const baseContext = baseCanvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        baseContext?.clearRect(0, 0, baseCanvas.width, baseCanvas.height)
        context?.drawImage(image, 0, 0)
        baseContext?.drawImage(image, 0, 0)
        uploadEditableTexture()
        setTextureResolution(`${canvas.width} x ${canvas.height}`)
      }
      image.onerror = () => {
        if (alive) {
          setStatus('The selected albedo texture could not be decoded.')
        }
      }
      image.src = dataUrl
    }

    if (texture?.dataUrl) {
      void loadTextureImage(texture.dataUrl)
    }

    return () => {
      alive = false
    }
  }, [setStatus, setTextureResolution, texture?.dataUrl])

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
      uploadEditableTexture()
      setTextureResolution(`${DEFAULT_TEXTURE_SIZE} x ${DEFAULT_TEXTURE_SIZE}`)
    }
  }, [setTextureResolution, texture])

  useEffect(() => {
    let alive = true

    if (!projectionImage?.dataUrl) {
      projectionImageRef.current = null
      projectionContextRef.current = null
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
    }
    image.src = projectionImage.dataUrl

    return () => {
      alive = false
    }
  }, [projectionImage?.dataUrl])

  useEffect(() => {
    function finishStroke(): void {
      drawingRef.current = false
    }

    window.addEventListener('pointerup', finishStroke)
    return () => window.removeEventListener('pointerup', finishStroke)
  }, [])

  function paintFromEvent(event: ThreeEvent<PointerEvent>): void {
    if (mode === 'orbit') {
      return
    }

    if (!event.uv) {
      setStatus('The selected mesh has no UV at the pointer hit.')
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
    setLastUv(`${event.uv.x.toFixed(3)}, ${event.uv.y.toFixed(3)}`)
  }

  function paintProjectionFromEvent(event: ThreeEvent<PointerEvent>, centerUv: THREE.Vector2): void {
    const viewport = workViewportRef.current
    const image = projectionImageRef.current
    const projectionContext = projectionContextRef.current

    if (!viewport || !image || !projectionContext) {
      setStatus('Load a projection image before using Projection Paint.')
      return
    }

    const rect = viewport.getBoundingClientRect()
    const centerX = event.nativeEvent.clientX
    const centerY = event.nativeEvent.clientY
    const radius = brushSize / 2
    const sampleStep = Math.max(2, Math.round(radius / 7))
    const stampRadius = Math.max(1.4, sampleStep * 0.65)
    let hits = 0

    for (let y = -radius; y <= radius; y += sampleStep) {
      for (let x = -radius; x <= radius; x += sampleStep) {
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
          hardness: 0.45
        })
        hits += 1
      }
    }

    if (hits === 0) {
      setStatus('Projection Paint did not hit visible UVs under the brush.')
      return
    }

    uploadEditableTexture()
    setLastUv(`${centerUv.x.toFixed(3)}, ${centerUv.y.toFixed(3)}`)
  }

  function sampleProjectionColor(clientX: number, clientY: number, rect: DOMRect): RgbaColor | null {
    const image = projectionImageRef.current
    const context = projectionContextRef.current
    if (!image || !context) {
      return null
    }

    const contained = getContainedImageRect(image.naturalWidth, image.naturalHeight, rect.width, rect.height)
    const localX = clientX - rect.left - contained.x
    const localY = clientY - rect.top - contained.y

    if (localX < 0 || localY < 0 || localX > contained.width || localY > contained.height) {
      return null
    }

    const sourceX = clamp(Math.floor((localX / contained.width) * image.naturalWidth), 0, image.naturalWidth - 1)
    const sourceY = clamp(Math.floor((localY / contained.height) * image.naturalHeight), 0, image.naturalHeight - 1)
    const pixel = context.getImageData(sourceX, sourceY, 1, 1).data

    return {
      r: pixel[0],
      g: pixel[1],
      b: pixel[2],
      a: pixel[3] / 255
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

  function uploadEditableTexture(): void {
    const canvas = textureCanvasRef.current
    const textureMap = textureRef.current
    if (!canvas || !textureMap) {
      return
    }

    textureMap.source.data = canvas
    textureMap.colorSpace = THREE.SRGBColorSpace
    textureMap.needsUpdate = true
    setTextureRevision((revision) => revision + 1)
  }

  return (
    <div className="viewport-grid">
      <div className="viewport-wrap" ref={workViewportRef}>
        <ViewportLabel title="Projection View" subtitle={mode === 'projectionPaint' ? 'Projection Paint' : 'Work'} />
        <ViewportScene
          modelContent={model?.content ?? null}
          texture={editableTexture}
          controlsEnabled={mode === 'orbit'}
          onPointerDown={(event) => {
            drawingRef.current = true
            paintFromEvent(event)
          }}
          onPointerMove={(event) => {
            if (drawingRef.current) {
              paintFromEvent(event)
            }
          }}
          onMissingUv={() => setStatus('The selected mesh has no UV at the pointer hit.')}
        />
        {projectionImage && (
          <img
            className="projection-overlay"
            src={projectionImage.dataUrl}
            alt=""
            style={{ opacity: projectionOpacity }}
            draggable={false}
          />
        )}
        {!model && <EmptyOverlay title="No OBJ loaded" body="Use the OBJ button to start." />}
        {model && !projectionImage && mode === 'projectionPaint' && (
          <EmptyOverlay title="No projection image" body="Load a Projection image before painting." />
        )}
      </div>

      <div className="viewport-wrap">
        <ViewportLabel title="Result View" subtitle="Final texture" />
        <ViewportScene modelContent={model?.content ?? null} texture={editableTexture} controlsEnabled />
        {!model && <EmptyOverlay title="No result yet" body="The final view updates after an OBJ is loaded." />}
      </div>
    </div>
  )
})

interface ViewportSceneProps {
  modelContent: string | null
  texture: THREE.Texture
  controlsEnabled: boolean
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void
  onMissingUv?: () => void
}

function ViewportScene({
  modelContent,
  texture,
  controlsEnabled,
  onPointerDown,
  onPointerMove,
  onMissingUv
}: ViewportSceneProps): ReactElement {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 4], fov: 45, near: 0.01, far: 1000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#e9e6dc']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 6, 4]} intensity={2.1} />
      <Suspense fallback={null}>
        <Environment preset="studio" />
        {modelContent ? (
          <Bounds fit clip observe margin={1.15}>
            <Center>
              <LoadedObj
                objContent={modelContent}
                texture={texture}
                textureRevision={textureRevision}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onMissingUv={onMissingUv}
              />
            </Center>
          </Bounds>
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
      <OrbitControls enabled={controlsEnabled} makeDefault />
    </Canvas>
  )
}

interface LoadedObjProps {
  objContent: string
  texture: THREE.Texture
  textureRevision: number
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void
  onMissingUv?: () => void
}

function LoadedObj({
  objContent,
  texture,
  textureRevision,
  onPointerDown,
  onPointerMove,
  onMissingUv
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
          entry.map = texture
          entry.needsUpdate = true
        })
      } else {
        material.map = texture
        material.needsUpdate = true
      }
    })
  }, [object, texture, textureRevision])

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

function getContainedImageRect(
  imageWidth: number,
  imageHeight: number,
  boundsWidth: number,
  boundsHeight: number
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(boundsWidth / imageWidth, boundsHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale

  return {
    x: (boundsWidth - width) / 2,
    y: (boundsHeight - height) / 2,
    width,
    height
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
