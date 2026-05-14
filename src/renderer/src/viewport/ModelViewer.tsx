import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Bounds, Center, Environment, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { useTextureToolStore } from '../store'

export interface ModelViewerHandle {
  getTextureDataUrl: () => string | null
}

const DEFAULT_TEXTURE_SIZE = 1024

export const ModelViewer = forwardRef<ModelViewerHandle>(function ModelViewer(_props, ref): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const drawingRef = useRef(false)
  const {
    model,
    texture,
    mode,
    brushColor,
    brushSize,
    brushOpacity,
    setTextureResolution,
    setLastUv,
    setStatus
  } = useTextureToolStore()

  const editableTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = DEFAULT_TEXTURE_SIZE
    canvas.height = DEFAULT_TEXTURE_SIZE
    canvasRef.current = canvas
    drawFallbackTexture(canvas)

    const nextTexture = new THREE.CanvasTexture(canvas)
    nextTexture.colorSpace = THREE.SRGBColorSpace
    nextTexture.flipY = true
    nextTexture.wrapS = THREE.RepeatWrapping
    nextTexture.wrapT = THREE.RepeatWrapping
    textureRef.current = nextTexture

    return nextTexture
  }, [])

  useImperativeHandle(ref, () => ({
    getTextureDataUrl: () => canvasRef.current?.toDataURL('image/png') ?? null
  }))

  useEffect(() => {
    let alive = true

    async function loadTextureImage(dataUrl: string): Promise<void> {
      const image = new window.Image()
      image.onload = () => {
        if (!alive || !canvasRef.current || !textureRef.current) {
          return
        }

        const canvas = canvasRef.current
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        context?.drawImage(image, 0, 0)
        textureRef.current.needsUpdate = true
        setTextureResolution(`${canvas.width} x ${canvas.height}`)
      }
      image.src = dataUrl
    }

    if (texture?.dataUrl) {
      void loadTextureImage(texture.dataUrl)
    }

    return () => {
      alive = false
    }
  }, [setTextureResolution, texture?.dataUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!texture && canvas) {
      canvas.width = DEFAULT_TEXTURE_SIZE
      canvas.height = DEFAULT_TEXTURE_SIZE
      drawFallbackTexture(canvas)
      textureRef.current!.needsUpdate = true
      setTextureResolution(`${DEFAULT_TEXTURE_SIZE} x ${DEFAULT_TEXTURE_SIZE}`)
    }
  }, [setTextureResolution, texture])

  useEffect(() => {
    function finishStroke(): void {
      drawingRef.current = false
    }

    window.addEventListener('pointerup', finishStroke)
    return () => window.removeEventListener('pointerup', finishStroke)
  }, [])

  function paintFromEvent(event: ThreeEvent<PointerEvent>): void {
    if (mode === 'orbit' || !event.uv) {
      return
    }

    event.stopPropagation()
    paintAtUv(event.uv)
  }

  function paintAtUv(uv: THREE.Vector2): void {
    const canvas = canvasRef.current
    const textureMap = textureRef.current
    if (!canvas || !textureMap) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const x = uv.x * canvas.width
    const y = (1 - uv.y) * canvas.height
    const radius = brushSize / 2

    context.save()
    context.globalAlpha = brushOpacity
    context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    context.fillStyle = brushColor
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
    context.restore()

    textureMap.needsUpdate = true
    setLastUv(`${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}`)
  }

  return (
    <div className="viewport-wrap">
      <Canvas
        camera={{ position: [0, 1.2, 4], fov: 45, near: 0.01, far: 1000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          drawingRef.current = false
        }}
      >
        <color attach="background" args={['#e9e6dc']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 6, 4]} intensity={2.1} />
        <Suspense fallback={null}>
          <Environment preset="studio" />
          {model ? (
            <Bounds fit clip observe margin={1.15}>
              <Center>
                <LoadedObj
                  objContent={model.content}
                  texture={editableTexture}
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
        <OrbitControls enabled={mode === 'orbit'} makeDefault />
      </Canvas>
      {!model && (
        <div className="viewport-empty">
          <strong>No OBJ loaded</strong>
          <span>Use the OBJ button to start.</span>
        </div>
      )}
    </div>
  )
})

interface LoadedObjProps {
  objContent: string
  texture: THREE.Texture
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
  onMissingUv: () => void
}

function LoadedObj({
  objContent,
  texture,
  onPointerDown,
  onPointerMove,
  onMissingUv
}: LoadedObjProps): JSX.Element {
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
      child.material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.68,
        metalness: 0,
        side: THREE.DoubleSide
      })
    })

    return parsed
  }, [objContent, texture])

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
      onMissingUv()
    }
    onPointerDown(event)
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>): void {
    if (!event.uv) {
      return
    }
    onPointerMove(event)
  }

  return <primitive object={object} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} />
}

function EmptyScene(): JSX.Element {
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
