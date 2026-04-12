'use client'

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface TimelineFrame {
  hour: number
  label: string
  description: string
  regions: Array<{
    region_id: string
    status: string
    coverage_volume: number
    dominant_quote: string
    outlet_count: number
    key_outlets: string[]
  }>
  flows: Array<{
    from: string
    to: string
    type: string
  }>
}

export interface PropagationGlobeProps {
  timeline: TimelineFrame[]
  storyHeadline: string
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const GLOBE_RADIUS = 2

const REGION_COORDS: Record<string, [number, number]> = {
  us: [39.8, -98.5],
  ca: [56.1, -106.3],
  mx: [23.6, -102.5],
  la: [-14.2, -51.9],
  uk: [55.3, -3.4],
  eu: [48.8, 9.0],
  ru: [61.5, 105.3],
  tr: [38.9, 35.2],
  me: [29.3, 47.5],
  ir: [32.4, 53.7],
  il: [31.0, 34.8],
  af: [-8.8, 34.5],
  in: [20.6, 78.9],
  cn: [35.9, 104.2],
  jp: [36.2, 138.2],
  kr: [35.9, 127.8],
  sea: [1.3, 103.8],
  au: [-25.3, 133.8],
  pk: [30.4, 69.3],
}

const REGION_LABELS: Record<string, string> = {
  us: 'US',
  ca: 'Canada',
  mx: 'Mexico',
  la: 'Latin Am.',
  uk: 'UK',
  eu: 'Europe',
  ru: 'Russia',
  tr: 'Turkey',
  me: 'Mid. East',
  ir: 'Iran',
  il: 'Israel',
  af: 'Africa',
  in: 'India',
  cn: 'China',
  jp: 'Japan',
  kr: 'Korea',
  sea: 'SE Asia',
  au: 'Australia',
  pk: 'Pakistan',
}

const STATUS_COLORS: Record<string, string> = {
  original: '#2A9D8F',
  wire_copy: '#457B9D',
  reframed: '#F4A261',
  contradicted: '#E63946',
  silent: '#2A2A2E',
}

const STATUS_LABELS: Record<string, string> = {
  original: 'Original',
  wire_copy: 'Wire Copy',
  reframed: 'Reframed',
  contradicted: 'Contradicted',
}

const MAX_ARCS = 50

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  const x = -(radius * Math.sin(phi) * Math.cos(theta))
  const z = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)
  return new THREE.Vector3(x, y, z)
}

function createArcCurve(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number
): THREE.CubicBezierCurve3 {
  const mid = start.clone().add(end).multiplyScalar(0.5)
  const distance = start.distanceTo(end)
  mid.normalize().multiplyScalar(radius + distance * 0.35)
  const control1 = start.clone().lerp(mid, 0.33)
  const control2 = end.clone().lerp(mid, 0.33)
  return new THREE.CubicBezierCurve3(start, control1, control2, end)
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.silent
}

/* ------------------------------------------------------------------ */
/*  Globe mesh                                                          */
/* ------------------------------------------------------------------ */

function GlobeMesh({ rotationRef }: { rotationRef: React.MutableRefObject<number> }) {
  const globeRef = useRef<THREE.Mesh>(null)
  const wireRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    const dr = delta * 0.05
    rotationRef.current += dr
    if (globeRef.current) globeRef.current.rotation.y += dr
    if (wireRef.current) wireRef.current.rotation.y += dr
    if (glowRef.current) glowRef.current.rotation.y += dr
  })

  return (
    <group>
      <mesh ref={globeRef}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial color="#12121A" roughness={0.9} metalness={0.1} />
      </mesh>

      <mesh ref={wireRef}>
        <sphereGeometry args={[GLOBE_RADIUS + 0.002, 32, 16]} />
        <meshBasicMaterial color="#2A2A40" wireframe transparent opacity={0.12} />
      </mesh>

      <mesh ref={glowRef}>
        <sphereGeometry args={[GLOBE_RADIUS + 0.06, 32, 32]} />
        <meshBasicMaterial color="#1A1A3A" transparent opacity={0.18} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Region markers                                                      */
/* ------------------------------------------------------------------ */

interface RegionData {
  status: string
  coverage_volume: number
}

function RegionMarkers({
  activeRegions,
  globeRotationRef,
}: {
  activeRegions: Map<string, RegionData>
  globeRotationRef: React.MutableRefObject<number>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const meshMap = useRef<Map<string, THREE.Mesh>>(new Map())
  const pulsePhase = useRef<Map<string, number>>(new Map())

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = globeRotationRef.current
    }

    meshMap.current.forEach((mesh, regionId) => {
      const data = activeRegions.get(regionId)
      const isActive = !!data
      const color = new THREE.Color(statusColor(data?.status ?? 'silent'))

      let phase = pulsePhase.current.get(regionId) ?? 0
      if (isActive) {
        phase = (phase + delta * 2.5) % (Math.PI * 2)
        pulsePhase.current.set(regionId, phase)
      }

      const mat = mesh.material as THREE.MeshBasicMaterial
      if (isActive) {
        const brightness = 0.7 + Math.sin(phase) * 0.3
        mat.color.copy(color).multiplyScalar(brightness)
        mat.opacity = 0.9
        const baseScale = data?.status === 'original' ? 1.6 : 1.1
        mesh.scale.setScalar(baseScale + Math.sin(phase) * 0.15)
      } else {
        mat.color.set('#333340')
        mat.opacity = 0.4
        mesh.scale.setScalar(0.5)
      }
    })
  })

  const entries = useMemo(() => Object.entries(REGION_COORDS), [])

  return (
    <group ref={groupRef}>
      {entries.map(([regionId, [lat, lng]]) => {
        const pos = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.04)
        return (
          <mesh
            key={regionId}
            position={pos}
            ref={(el: THREE.Mesh | null) => {
              if (el) meshMap.current.set(regionId, el)
            }}
          >
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color="#333340" transparent opacity={0.4} />
          </mesh>
        )
      })}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Arc data                                                            */
/* ------------------------------------------------------------------ */

interface ArcEntry {
  id: string
  curve: THREE.CubicBezierCurve3
  color: THREE.Color
  progress: number
  age: number
  allPoints: THREE.Vector3[]
}

/* ------------------------------------------------------------------ */
/*  Single arc rendered via primitive THREE.Line                        */
/* ------------------------------------------------------------------ */

function ArcLine({ arc }: { arc: ArcEntry }) {
  const lineRef = useRef<THREE.Line | null>(null)

  const lineObject = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(arc.allPoints.length * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({
      color: arc.color,
      transparent: true,
      opacity: 0.8,
    })
    return new THREE.Line(geo, mat)
  }, [arc.allPoints, arc.color])

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose()
      ;(lineObject.material as THREE.Material).dispose()
    }
  }, [lineObject])

  useFrame(() => {
    const visibleCount = Math.max(2, Math.floor(arc.progress * arc.allPoints.length))
    const pts = arc.allPoints.slice(0, visibleCount)

    const geo = lineObject.geometry
    const buf = geo.getAttribute('position') as THREE.BufferAttribute

    // Resize if needed
    if (buf.count !== pts.length) {
      const newBuf = new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3)
      for (let i = 0; i < pts.length; i++) {
        newBuf.setXYZ(i, pts[i].x, pts[i].y, pts[i].z)
      }
      geo.setAttribute('position', newBuf)
    } else {
      for (let i = 0; i < pts.length; i++) {
        buf.setXYZ(i, pts[i].x, pts[i].y, pts[i].z)
      }
      buf.needsUpdate = true
    }

    geo.setDrawRange(0, pts.length)
    geo.computeBoundingSphere()

    const mat = lineObject.material as THREE.LineBasicMaterial
    const opacity = arc.age > 4 ? Math.max(0, 1 - (arc.age - 4) / 3) : 0.8
    mat.opacity = opacity
  })

  return <primitive object={lineObject} ref={lineRef} />
}

/* ------------------------------------------------------------------ */
/*  Destination flash                                                   */
/* ------------------------------------------------------------------ */

function DestFlash({
  position,
  color,
  onDone,
}: {
  position: THREE.Vector3
  color: THREE.Color
  onDone: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const age = useRef(0)
  const done = useRef(false)

  useFrame((_, delta) => {
    if (done.current) return
    age.current += delta
    if (!meshRef.current) return
    const t = age.current / 0.6
    meshRef.current.scale.setScalar(1 + t * 3)
    const mat = meshRef.current.material as THREE.MeshBasicMaterial
    mat.opacity = Math.max(0, 1 - t)
    if (age.current > 0.6) {
      done.current = true
      onDone()
    }
  })

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={1} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/*  Main scene (inside Canvas)                                          */
/* ------------------------------------------------------------------ */

interface SceneProps {
  timeline: TimelineFrame[]
  currentFrameIdx: number
  globeRotationRef: React.MutableRefObject<number>
}

function Scene({ timeline, currentFrameIdx, globeRotationRef }: SceneProps) {
  const [arcs, setArcs] = useState<ArcEntry[]>([])
  const [flashes, setFlashes] = useState<
    Array<{ id: string; pos: THREE.Vector3; color: THREE.Color }>
  >([])
  const processedFlows = useRef<Set<string>>(new Set())
  const arcsRef = useRef<ArcEntry[]>([])

  const frame = timeline[currentFrameIdx]
  const activeRegions = useMemo(
    () => new Map(frame.regions.map((r) => [r.region_id, r])),
    [frame]
  )

  // When frame changes, spawn arcs for new flows
  useEffect(() => {
    const newFlows = frame.flows.slice(0, MAX_ARCS)
    let added = false

    newFlows.forEach((flow, i) => {
      const key = `${currentFrameIdx}-${flow.from}-${flow.to}-${i}`
      if (processedFlows.current.has(key)) return
      processedFlows.current.add(key)

      const fromCoords = REGION_COORDS[flow.from]
      const toCoords = REGION_COORDS[flow.to]
      if (!fromCoords || !toCoords) return

      const start = latLngToVector3(fromCoords[0], fromCoords[1], GLOBE_RADIUS + 0.04)
      const end = latLngToVector3(toCoords[0], toCoords[1], GLOBE_RADIUS + 0.04)

      // Apply current globe rotation so arcs are positioned correctly in world space
      const rot = globeRotationRef.current
      const rotMat = new THREE.Matrix4().makeRotationY(rot)
      start.applyMatrix4(rotMat)
      end.applyMatrix4(rotMat)

      const curve = createArcCurve(start, end, GLOBE_RADIUS + 0.04)
      const color = new THREE.Color(statusColor(flow.type))
      const allPoints = curve.getPoints(80)

      const entry: ArcEntry = {
        id: key,
        curve,
        color,
        progress: 0,
        age: 0,
        allPoints,
      }

      arcsRef.current = [...arcsRef.current.slice(-MAX_ARCS + 1), entry]
      added = true
    })

    if (added) setArcs([...arcsRef.current])
  }, [currentFrameIdx, frame.flows, globeRotationRef])

  useFrame((_, delta) => {
    let changed = false

    arcsRef.current = arcsRef.current.map((arc) => {
      if (arc.progress < 1) {
        const newProgress = Math.min(1, arc.progress + delta * 0.85)
        changed = true

        // Trigger destination flash when arc completes
        if (newProgress >= 1 && arc.progress < 1) {
          const endPt = arc.allPoints[arc.allPoints.length - 1]
          setFlashes((prev) => [
            ...prev,
            { id: `flash-${arc.id}`, pos: endPt.clone(), color: arc.color.clone() },
          ])
        }
        return { ...arc, progress: newProgress }
      }
      const newAge = arc.age + delta
      changed = true
      return { ...arc, age: newAge }
    })

    // Remove faded arcs
    const filtered = arcsRef.current.filter((a) => a.age < 7)
    if (filtered.length !== arcsRef.current.length) {
      arcsRef.current = filtered
      changed = true
    }

    if (changed) setArcs([...arcsRef.current])
  })

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.8} color="#4477AA" />
      <pointLight position={[-10, -5, -5]} intensity={0.4} color="#221133" />
      <pointLight position={[0, 8, 0]} intensity={0.3} color="#334488" />

      <Stars radius={60} depth={50} count={4000} factor={3} saturation={0.2} fade speed={0.5} />

      <GlobeMesh rotationRef={globeRotationRef} />

      <RegionMarkers activeRegions={activeRegions} globeRotationRef={globeRotationRef} />

      {arcs.map((arc) => (
        <ArcLine key={arc.id} arc={arc} />
      ))}

      {flashes.map((f) => (
        <DestFlash
          key={f.id}
          position={f.pos}
          color={f.color}
          onDone={() =>
            setFlashes((prev) => prev.filter((x) => x.id !== f.id))
          }
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.4}
        zoomSpeed={0.6}
        minDistance={2.5}
        maxDistance={8}
        enablePan={false}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Main exported component                                             */
/* ------------------------------------------------------------------ */

interface PlaybackState {
  frameIdx: number
  progress: number
  playing: boolean
  speed: number
}

export function PropagationGlobe({ timeline, storyHeadline }: PropagationGlobeProps) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const stateRef = useRef<PlaybackState>({ frameIdx: 0, progress: 0, playing: true, speed: 1 })
  const globeRotationRef = useRef<number>(0)

  // Keep stateRef in sync to avoid stale closure issues in RAF
  stateRef.current = { frameIdx, progress, playing, speed }

  const limited = !timeline || timeline.length < 3

  const tick = useCallback(
    (time: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = time
      }
      const delta = Math.min((time - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = time

      const { frameIdx: fi, progress: pr, playing: pl, speed: sp } = stateRef.current

      if (pl && !limited) {
        // 15 seconds total at 1x to traverse all frames
        const frameDuration = 15 / Math.max(timeline.length, 1)
        const newProgress = pr + (delta * sp) / frameDuration

        if (newProgress >= 1) {
          if (fi < timeline.length - 1) {
            setFrameIdx(fi + 1)
            setProgress(0)
          } else {
            setPlaying(false)
            setProgress(1)
          }
        } else {
          setProgress(newProgress)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [limited, timeline.length]
  )

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  const togglePlay = useCallback(() => {
    if (!playing && frameIdx >= timeline.length - 1) {
      setFrameIdx(0)
      setProgress(0)
      lastTimeRef.current = null
      setPlaying(true)
    } else {
      setPlaying((p) => !p)
    }
  }, [playing, frameIdx, timeline.length])

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaying(false)
    lastTimeRef.current = null
    setFrameIdx(Number(e.target.value))
    setProgress(0)
  }, [])

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s)
    lastTimeRef.current = null
  }, [])

  const frame = timeline[Math.min(frameIdx, timeline.length - 1)]
  const activeRegions = frame
    ? frame.regions.filter((r) => r.status !== 'silent').slice(0, 8)
    : []

  /* ---- empty state ---- */
  if (limited) {
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          maxHeight: '500px',
          background: '#0A0A0B',
          border: '1px solid #1e1e1e',
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #1A1A2E, #0A0A0B)',
            border: '1px solid #2A2A2E',
            boxShadow: '0 0 30px rgba(42, 157, 143, 0.1)',
          }}
        />
        <p
          style={{
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: '12px',
            color: '#5C5A56',
            textAlign: 'center',
            margin: 0,
          }}
        >
          Limited propagation data for this story.
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        background: '#0A0A0B',
        border: '1px solid #1e1e1e',
        borderRadius: '10px',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
      }}
    >
      {/* Story headline label */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          left: '16px',
          zIndex: 10,
          maxWidth: '55%',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontSize: '9px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: '#5C5A56',
            marginBottom: '4px',
          }}
        >
          Story Propagation
        </div>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#E8E6E3',
            lineHeight: 1.3,
            fontFamily: 'var(--font-body, "IBM Plex Sans", sans-serif)',
          }}
        >
          {storyHeadline}
        </div>
      </div>

      {/* Frame time — top right */}
      {frame && (
        <div
          style={{
            position: 'absolute',
            top: '14px',
            right: '16px',
            zIndex: 10,
            textAlign: 'right',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: '22px',
              fontWeight: 600,
              color: '#2A9D8F',
              lineHeight: 1,
            }}
          >
            +{frame.hour}h
          </div>
          <div style={{ fontSize: '10px', color: '#5C5A56', marginTop: '2px' }}>
            {frame.label}
          </div>
        </div>
      )}

      {/* Canvas */}
      <div style={{ width: '100%', aspectRatio: '16/9', maxHeight: '500px' }}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45, near: 0.1, far: 200 }}
          style={{ background: '#0A0A0B' }}
          gl={{ antialias: true, alpha: false }}
        >
          <Scene
            timeline={timeline}
            currentFrameIdx={frameIdx}
            globeRotationRef={globeRotationRef}
          />
        </Canvas>
      </div>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: '76px',
          left: '16px',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          pointerEvents: 'none',
        }}
      >
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: statusColor(key),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '9px',
                color: '#5C5A56',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Active regions info panel */}
      {activeRegions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '76px',
            right: '16px',
            zIndex: 10,
            width: '200px',
            background: 'rgba(10, 10, 11, 0.88)',
            border: '1px solid #1e1e1e',
            borderRadius: '6px',
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              fontSize: '9px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#5C5A56',
              marginBottom: '8px',
            }}
          >
            Active Regions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {activeRegions.map((r) => (
              <div key={r.region_id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: statusColor(r.status),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#B0ADA5',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {REGION_LABELS[r.region_id] ?? r.region_id.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '9px', color: '#5C5A56', flexShrink: 0 }}>
                    {r.outlet_count} outlets
                  </span>
                </div>
                {r.dominant_quote && (
                  <div
                    style={{
                      fontSize: '9px',
                      fontStyle: 'italic',
                      color: '#5C5A56',
                      marginTop: '2px',
                      marginLeft: '12px',
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    &ldquo;{r.dominant_quote}&rdquo;
                  </div>
                )}
              </div>
            ))}
          </div>
          {frame && (
            <div
              style={{
                marginTop: '10px',
                paddingTop: '8px',
                borderTop: '1px solid #1e1e1e',
                fontSize: '9px',
                color: '#5C5A56',
                lineHeight: 1.4,
                fontFamily: 'var(--font-body, "IBM Plex Sans", sans-serif)',
              }}
            >
              {frame.description}
            </div>
          )}
        </div>
      )}

      {/* Timeline controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'rgba(10, 10, 11, 0.92)',
          borderTop: '1px solid #1e1e1e',
          padding: '10px 16px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            style={{
              background: 'none',
              border: '1px solid #2A2A2E',
              borderRadius: '4px',
              color: '#B0ADA5',
              fontSize: '11px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono, monospace)',
              flexShrink: 0,
              lineHeight: 1.4,
            }}
          >
            {playing ? '||' : '\u25B6'}
          </button>

          {/* Scrubber */}
          <input
            type="range"
            min={0}
            max={timeline.length - 1}
            value={frameIdx}
            onChange={handleSlider}
            style={{
              flex: 1,
              accentColor: '#2A9D8F',
              height: '4px',
              cursor: 'pointer',
            }}
          />

          {/* Current hour */}
          <span
            style={{
              fontSize: '10px',
              color: '#5C5A56',
              flexShrink: 0,
              minWidth: '44px',
              textAlign: 'right',
            }}
          >
            +{frame?.hour ?? 0}h
          </span>

          {/* Speed selector */}
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            {([0.5, 1, 2] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                style={{
                  background: speed === s ? '#2A9D8F' : 'none',
                  border: `1px solid ${speed === s ? '#2A9D8F' : '#2A2A2E'}`,
                  borderRadius: '3px',
                  color: speed === s ? '#0A0A0B' : '#5C5A56',
                  fontSize: '9px',
                  padding: '3px 6px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: speed === s ? 700 : 400,
                }}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Frame tick marks */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '6px',
            paddingLeft: '38px',
            paddingRight: '90px',
          }}
        >
          {timeline.map((f, i) => (
            <div
              key={i}
              title={`+${f.hour}h`}
              onClick={() => {
                setPlaying(false)
                lastTimeRef.current = null
                setFrameIdx(i)
                setProgress(0)
              }}
              style={{
                width: '1px',
                height: i === frameIdx ? '8px' : '4px',
                background: i === frameIdx ? '#2A9D8F' : '#2A2A2E',
                transition: 'height 150ms ease, background 150ms ease',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
