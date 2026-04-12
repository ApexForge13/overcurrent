'use client'

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
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
  us:  [39.8,  -98.5],
  ca:  [56.1, -106.3],
  mx:  [23.6, -102.5],
  la:  [-14.2,  -51.9],
  uk:  [55.3,   -3.4],
  eu:  [48.8,    9.0],
  ru:  [61.5,  105.3],
  tr:  [38.9,   35.2],
  me:  [29.3,   47.5],
  ir:  [32.4,   53.7],
  il:  [31.0,   34.8],
  af:  [-8.8,   34.5],
  in:  [20.6,   78.9],
  cn:  [35.9,  104.2],
  jp:  [36.2,  138.2],
  kr:  [35.9,  127.8],
  sea: [ 1.3,  103.8],
  au:  [-25.3, 133.8],
  pk:  [30.4,   69.3],
}

const REGION_LABELS: Record<string, string> = {
  us:  'US',
  ca:  'Canada',
  mx:  'Mexico',
  la:  'Latin Am.',
  uk:  'UK',
  eu:  'Europe',
  ru:  'Russia',
  tr:  'Turkey',
  me:  'Mid. East',
  ir:  'Iran',
  il:  'Israel',
  af:  'Africa',
  in:  'India',
  cn:  'China',
  jp:  'Japan',
  kr:  'Korea',
  sea: 'SE Asia',
  au:  'Australia',
  pk:  'Pakistan',
}

const STATUS_COLORS: Record<string, string> = {
  original:     '#2A9D8F',
  wire_copy:    '#457B9D',
  reframed:     '#F4A261',
  contradicted: '#E63946',
  silent:       '#2A2A2E',
}

const STATUS_LABELS: Record<string, string> = {
  original:     'Original',
  wire_copy:    'Wire Copy',
  reframed:     'Reframed',
  contradicted: 'Contradicted',
}

const MAX_ARCS = 50

/* ------------------------------------------------------------------ */
/*  Continent outlines — rough coastline paths for geographic context   */
/* ------------------------------------------------------------------ */

const CONTINENT_OUTLINES: [number, number][][] = [
  // North America - detailed coastline
  [
    [70,-165],[68,-165],[65,-168],[62,-166],[60,-164],[58,-157],[57,-153],[59,-150],
    [60,-147],[60,-141],[58,-137],[55,-133],[52,-131],[49,-127],[48,-124],[45,-124],
    [42,-124],[39,-123],[37,-122],[35,-121],[33,-118],[32,-117],[31,-115],[29,-113],
    [26,-110],[24,-106],[22,-100],[20,-97],[19,-96],[18,-92],[18,-89],[20,-87],
    [21,-87],[23,-84],[25,-81],[27,-80],[29,-81],[30,-82],[31,-81],[33,-79],
    [35,-76],[37,-76],[39,-74],[41,-72],[42,-71],[43,-70],[44,-67],[45,-62],
    [47,-61],[48,-59],[47,-56],[48,-53],[50,-55],[52,-56],[53,-60],[55,-60],
    [57,-62],[59,-64],[60,-65],[62,-74],[64,-77],[66,-82],[68,-90],[69,-96],
    [70,-105],[71,-115],[71,-130],[71,-140],[71,-155],[70,-165],
  ],
  // South America
  [
    [12,-72],[10,-76],[8,-77],[5,-77],[2,-79],[0,-80],[-2,-80],[-5,-79],
    [-7,-77],[-9,-76],[-11,-75],[-13,-74],[-15,-75],[-17,-73],[-19,-70],
    [-21,-65],[-23,-60],[-24,-55],[-25,-50],[-26,-48],[-28,-49],[-30,-51],
    [-32,-52],[-34,-53],[-36,-56],[-38,-58],[-40,-62],[-42,-64],[-44,-66],
    [-46,-68],[-48,-70],[-50,-73],[-52,-70],[-54,-69],[-55,-66],[-54,-64],
    [-52,-70],[-48,-66],[-44,-62],[-40,-58],[-37,-55],[-34,-52],[-30,-50],
    [-27,-49],[-24,-46],[-20,-44],[-16,-42],[-12,-40],[-8,-38],[-5,-37],
    [-2,-35],[0,-40],[2,-48],[4,-52],[6,-56],[8,-60],[10,-64],[11,-68],[12,-72],
  ],
  // Europe
  [
    [71,28],[70,32],[68,35],[65,30],[63,25],[60,22],[58,18],[57,12],
    [56,10],[55,8],[54,9],[53,5],[52,4],[51,2],[50,0],[49,-2],[48,-5],
    [47,-6],[46,-2],[45,0],[43,-3],[42,-6],[41,-8],[40,-8],[38,-8],
    [37,-6],[36,-5],[36,0],[37,5],[38,10],[39,15],[40,18],[41,20],
    [42,22],[43,25],[44,20],[45,14],[46,13],[47,15],[48,17],[49,18],
    [50,20],[51,22],[52,21],[53,24],[54,20],[55,23],[56,25],[57,25],
    [58,28],[60,30],[62,28],[64,27],[66,25],[68,22],[70,25],[71,28],
  ],
  // Africa
  [
    [37,-10],[36,-5],[35,-2],[34,0],[33,5],[32,10],[31,12],[30,15],
    [28,20],[25,25],[22,28],[20,30],[18,32],[15,34],[12,35],[10,38],
    [8,40],[5,42],[3,42],[1,40],[0,42],[-2,40],[-5,38],[-8,35],
    [-10,33],[-12,30],[-15,28],[-18,25],[-20,22],[-22,20],[-25,18],
    [-27,20],[-29,25],[-30,28],[-32,30],[-34,28],[-35,22],[-34,18],
    [-33,16],[-30,15],[-27,13],[-24,12],[-20,10],[-17,8],[-14,5],
    [-12,2],[-10,-2],[-8,-5],[-5,-8],[-2,-10],[0,-12],[2,-15],
    [5,-17],[8,-16],[10,-14],[12,-12],[15,-15],[18,-17],[20,-16],
    [22,-15],[25,-14],[28,-12],[30,-10],[33,-8],[35,-8],[37,-10],
  ],
  // Asia (simplified but higher res)
  [
    [42,28],[40,35],[38,40],[36,42],[34,45],[32,48],[30,50],[28,52],
    [25,55],[22,58],[20,60],[18,62],[15,65],[12,70],[10,75],[8,78],
    [6,80],[5,85],[3,90],[2,95],[1,100],[0,105],[-2,108],[-5,110],
    [-7,112],[-8,115],[-6,118],[-3,120],[0,120],[3,118],[5,115],
    [8,112],[10,110],[12,108],[15,110],[18,112],[20,115],[22,118],
    [25,120],[28,122],[30,125],[32,128],[35,130],[37,132],[38,135],
    [40,135],[42,133],[44,135],[46,140],[48,143],[50,145],[52,143],
    [54,140],[55,137],[56,135],[58,138],[60,142],[62,148],[64,155],
    [66,160],[68,170],[67,175],[65,170],[62,165],[60,160],[58,155],
    [56,150],[55,145],[53,140],[52,135],[50,130],[48,128],[46,125],
    [44,120],[42,115],[40,110],[38,105],[36,100],[35,95],[34,90],
    [35,85],[36,80],[38,75],[40,70],[42,65],[44,60],[46,55],
    [48,50],[50,45],[52,42],[54,40],[56,38],[58,35],[60,32],
    [62,30],[64,28],[66,25],[68,22],[70,20],[72,25],[72,35],
    [72,50],[72,65],[72,80],[72,95],[72,110],[72,125],[72,140],
    [72,155],[72,170],[70,175],[68,170],[66,165],[64,160],
  ],
  // Australia
  [
    [-12,130],[-14,128],[-16,125],[-18,122],[-20,118],[-22,115],
    [-24,114],[-26,114],[-28,114],[-30,115],[-32,116],[-34,116],
    [-35,118],[-36,120],[-37,125],[-38,130],[-38,135],[-38,140],
    [-37,145],[-36,148],[-35,150],[-34,152],[-32,153],[-30,153],
    [-28,152],[-26,150],[-24,149],[-22,148],[-20,148],[-18,146],
    [-16,145],[-14,143],[-13,140],[-12,138],[-12,135],[-12,132],[-12,130],
  ],
]

/* ------------------------------------------------------------------ */
/*  City dots — "night Earth" geographic context                       */
/* ------------------------------------------------------------------ */

const CITY_DOTS: [number, number][] = [
  // North America
  [40.7,  -74.0],  // New York
  [34.0, -118.2],  // Los Angeles
  [41.9,  -87.6],  // Chicago
  [19.4,  -99.1],  // Mexico City
  [38.9,  -77.0],  // Washington DC
  // Europe
  [51.5,   -0.1],  // London
  [48.9,    2.3],  // Paris
  [52.5,   13.4],  // Berlin
  [41.9,   12.5],  // Rome
  [40.4,   -3.7],  // Madrid
  [55.8,   37.6],  // Moscow
  // Middle East
  [35.7,   51.4],  // Tehran
  [41.0,   29.0],  // Istanbul
  [30.0,   31.2],  // Cairo
  [24.7,   46.7],  // Riyadh
  [25.3,   55.3],  // Dubai
  // Asia
  [39.9,  116.4],  // Beijing
  [31.2,  121.5],  // Shanghai
  [35.7,  139.7],  // Tokyo
  [37.6,  127.0],  // Seoul
  [ 1.3,  103.9],  // Singapore
  [28.6,   77.2],  // New Delhi
  [19.1,   72.9],  // Mumbai
  // Africa
  [-33.9,  18.4],  // Cape Town
  [ -1.3,  36.8],  // Nairobi
  [  6.5,   3.4],  // Lagos
  // Latin America
  [-23.5, -46.6],  // Sao Paulo
  [-34.6, -58.4],  // Buenos Aires
  // Australia
  [-33.9, 151.2],  // Sydney
  [-37.8, 145.0],  // Melbourne
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  const x = -(radius * Math.sin(phi) * Math.cos(theta))
  const z =   radius * Math.sin(phi) * Math.sin(theta)
  const y =   radius * Math.cos(phi)
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
/*  Globe mesh with city dots and grid lines                           */
/* ------------------------------------------------------------------ */

function GlobeMesh({ rotationRef }: { rotationRef: React.MutableRefObject<number> }) {
  const globeRef      = useRef<THREE.Mesh>(null)
  const glowRef       = useRef<THREE.Mesh>(null)
  const dotsRef       = useRef<THREE.Group>(null)
  const gridRef       = useRef<THREE.Group>(null)
  const continentRef  = useRef<THREE.Group>(null)

  // Build city-dot geometry once
  const cityDotObjects = useMemo(() => {
    return CITY_DOTS.map(([lat, lng]) => {
      const pos = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.012)
      const geo = new THREE.SphereGeometry(0.015, 5, 5)
      const mat = new THREE.MeshBasicMaterial({
        color: '#5A5A6E',
        transparent: true,
        opacity: 1.0,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      return mesh
    })
  }, [])

  // Build lat/lng grid lines once — every 30 degrees, very subtle
  const gridLines = useMemo(() => {
    const lines: THREE.Line[] = []
    const R = GLOBE_RADIUS + 0.006

    // Latitude rings (every 30 deg: -60, -30, 0, 30, 60)
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = []
      for (let lng = 0; lng <= 360; lng += 4) {
        pts.push(latLngToVector3(lat, lng - 180, R))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({
        color: '#2A2A4A',
        transparent: true,
        opacity: 0.02,
      })
      lines.push(new THREE.Line(geo, mat))
    }

    // Longitude meridians (every 30 deg)
    for (let lng = 0; lng < 360; lng += 30) {
      const pts: THREE.Vector3[] = []
      for (let lat = -90; lat <= 90; lat += 3) {
        pts.push(latLngToVector3(lat, lng, R))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({
        color: '#2A2A4A',
        transparent: true,
        opacity: 0.02,
      })
      lines.push(new THREE.Line(geo, mat))
    }

    return lines
  }, [])

  // Build continent outline lines once
  const continentLines = useMemo(() => {
    const lines: THREE.Line[] = []
    const R = GLOBE_RADIUS + 0.008
    CONTINENT_OUTLINES.forEach((path) => {
      const pts = path.map(([lat, lng]) => latLngToVector3(lat, lng, R))
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({
        color:       '#7A7A8E',
        transparent: true,
        opacity:     0.5,
      })
      lines.push(new THREE.Line(geo, mat))
    })
    return lines
  }, [])

  useFrame((_, delta) => {
    const dr = delta * 0.05
    rotationRef.current += dr
    if (globeRef.current)     globeRef.current.rotation.y     += dr
    if (glowRef.current)      glowRef.current.rotation.y      += dr
    if (dotsRef.current)      dotsRef.current.rotation.y      += dr
    if (gridRef.current)      gridRef.current.rotation.y      += dr
    if (continentRef.current) continentRef.current.rotation.y += dr
  })

  return (
    <group>
      {/* Main sphere */}
      <mesh ref={globeRef}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial color="#12121A" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Atmospheric glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[GLOBE_RADIUS + 0.06, 32, 32]} />
        <meshBasicMaterial color="#1A1A3A" transparent opacity={0.18} side={THREE.BackSide} />
      </mesh>

      {/* City dots — "night Earth" effect */}
      <group ref={dotsRef}>
        {cityDotObjects.map((obj, i) => (
          <primitive key={i} object={obj} />
        ))}
      </group>

      {/* Lat/lng grid lines */}
      <group ref={gridRef}>
        {gridLines.map((line, i) => (
          <primitive key={i} object={line} />
        ))}
      </group>

      {/* Continent outline lines */}
      <group ref={continentRef}>
        {continentLines.map((line, i) => (
          <primitive key={`cont-${i}`} object={line} />
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Tactical marker — HUD-style rectangular target box                 */
/* ------------------------------------------------------------------ */

interface RegionData {
  status:          string
  coverage_volume: number
  outlet_count:    number
  dominant_quote:  string
}

interface TacticalMarkerProps {
  regionId:      string
  lat:           number
  lng:           number
  data:          RegionData | undefined
  activeCount:   number
  globeRotation: number
}

function TacticalMarker({ regionId, lat, lng, data, activeCount, globeRotation }: TacticalMarkerProps) {
  const isActive     = !!data
  const color        = isActive ? statusColor(data!.status) : '#333344'
  const label        = REGION_LABELS[regionId] ?? regionId.toUpperCase()
  const showFullDetail = activeCount < 5
  const pos          = useMemo(
    () => latLngToVector3(lat, lng, GLOBE_RADIUS + 0.12),
    [lat, lng]
  )

  // Fix 4: Calculate facing opacity based on dot product with camera
  const { camera } = useThree()
  const containerRef = useRef<HTMLDivElement>(null)

  useFrame(() => {
    const markerWorldPos = latLngToVector3(lat, lng, GLOBE_RADIUS)
    const rotatedPos = markerWorldPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), globeRotation)
    const cameraDir = camera.position.clone().normalize()
    const dotProduct = rotatedPos.normalize().dot(cameraDir)
    const facingOpacity = Math.max(0.1, dotProduct * 0.8 + 0.2)
    // Fix 3: Base opacity — active=1.0, inactive=0.3. Then multiply by facing opacity.
    const baseOpacity = isActive ? 1 : 0.3
    const finalOpacity = baseOpacity * facingOpacity
    if (containerRef.current) {
      containerRef.current.style.opacity = String(finalOpacity)
    }
  })

  return (
    <Html
      position={pos}
      center
      style={{ pointerEvents: 'none' }}
      distanceFactor={6}
    >
      <div
        ref={containerRef}
        style={{
          position:    'relative',
          padding:     '3px 6px',
          minWidth:    '44px',
          border:      `1px solid ${color}`,
          background:  isActive ? `${color}12` : 'transparent',
          fontFamily:  '"JetBrains Mono", "Courier New", monospace',
          opacity:     isActive ? 1 : 0.3,
          transition:  'border-color 0.4s ease',
          boxSizing:   'border-box',
        }}
      >
        {/* Corner brackets — only when fewer than 5 active regions */}
        {showFullDetail && isActive && (<>
          <div style={{
            position: 'absolute', top: -2, left: -2, width: 7, height: 7,
            borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}`,
          }} />
          <div style={{
            position: 'absolute', top: -2, right: -2, width: 7, height: 7,
            borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}`,
          }} />
          <div style={{
            position: 'absolute', bottom: -2, left: -2, width: 7, height: 7,
            borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}`,
          }} />
          <div style={{
            position: 'absolute', bottom: -2, right: -2, width: 7, height: 7,
            borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}`,
          }} />
        </>)}

        {/* Region label */}
        <div style={{
          fontSize:      '8px',
          color:         color,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          whiteSpace:    'nowrap',
          textAlign:     'center',
          lineHeight:    1.2,
        }}>
          {label}
        </div>

        {/* Data readout — only when active and showing full detail */}
        {isActive && showFullDetail && (
          <div style={{
            fontSize:     '7px',
            color:        '#8A8880',
            marginTop:    '2px',
            maxWidth:     '120px',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            textAlign:    'center',
          }}>
            {data!.outlet_count} outlets
            {data!.dominant_quote
              ? ` · ${data!.dominant_quote.substring(0, 24)}`
              : ''}
          </div>
        )}
      </div>
    </Html>
  )
}

/* ------------------------------------------------------------------ */
/*  Region markers — tactical boxes + pulse dots on globe surface      */
/* ------------------------------------------------------------------ */

function RegionMarkers({
  activeRegions,
  globeRotationRef,
}: {
  activeRegions:    Map<string, RegionData>
  globeRotationRef: React.MutableRefObject<number>
}) {
  const groupRef   = useRef<THREE.Group>(null)
  const meshMap    = useRef<Map<string, THREE.Mesh>>(new Map())
  const pulsePhase = useRef<Map<string, number>>(new Map())

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = globeRotationRef.current
    }

    meshMap.current.forEach((mesh, regionId) => {
      const data     = activeRegions.get(regionId)
      const isActive = !!data
      const color    = new THREE.Color(statusColor(data?.status ?? 'silent'))

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
        mesh.scale.setScalar(baseScale + Math.sin(phase) * 0.1)
      } else {
        mat.color.set('#333340')
        mat.opacity = 0.3
        mesh.scale.setScalar(0.5)
      }
    })
  })

  const entries = useMemo(() => Object.entries(REGION_COORDS), [])

  return (
    <group ref={groupRef}>
      {/* Pulse dot on globe surface */}
      {entries.map(([regionId, [lat, lng]]) => {
        const pos = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.04)
        return (
          <mesh
            key={`dot-${regionId}`}
            position={pos}
            ref={(el: THREE.Mesh | null) => {
              if (el) meshMap.current.set(regionId, el)
            }}
          >
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial color="#333340" transparent opacity={0.3} />
          </mesh>
        )
      })}

      {/* Tactical HTML markers — rendered in world space, not rotated with globe */}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Tactical markers in world space (not parented to rotating globe)   */
/* ------------------------------------------------------------------ */

function TacticalMarkerLayer({
  activeRegions,
  globeRotationRef,
}: {
  activeRegions:    Map<string, RegionData>
  globeRotationRef: React.MutableRefObject<number>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [globeRotation, setGlobeRotation] = useState(0)

  // Sync rotation to globe every frame
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = globeRotationRef.current
    }
    setGlobeRotation(globeRotationRef.current)
  })

  const entries     = useMemo(() => Object.entries(REGION_COORDS), [])
  const activeCount = activeRegions.size

  return (
    <group ref={groupRef}>
      {entries.map(([regionId, [lat, lng]]) => (
        <TacticalMarker
          key={`marker-${regionId}`}
          regionId={regionId}
          lat={lat}
          lng={lng}
          data={activeRegions.get(regionId)}
          activeCount={activeCount}
          globeRotation={globeRotation}
        />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Arc data                                                            */
/* ------------------------------------------------------------------ */

interface ArcEntry {
  id:         string
  curve:      THREE.CubicBezierCurve3
  color:      THREE.Color
  progress:   number
  age:        number
  allPoints:  THREE.Vector3[]
  frameIndex: number
}

/* ------------------------------------------------------------------ */
/*  Single arc rendered via primitive THREE.Line                        */
/* ------------------------------------------------------------------ */

function ArcLine({ arc }: { arc: ArcEntry }) {
  const lineRef = useRef<THREE.Line | null>(null)

  const lineObject = useMemo(() => {
    const geo      = new THREE.BufferGeometry()
    const positions = new Float32Array(arc.allPoints.length * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({
      color:       arc.color,
      transparent: true,
      opacity:     0.8,
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
    const pts          = arc.allPoints.slice(0, visibleCount)

    const geo = lineObject.geometry
    const buf = geo.getAttribute('position') as THREE.BufferAttribute

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

    const mat     = lineObject.material as THREE.LineBasicMaterial
    // Older arcs are slightly dimmer; newest arcs are full brightness
    mat.opacity   = arc.progress < 1 ? 0.8 : (arc.age > 0 ? 0.4 : 0.8)
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
  color:    THREE.Color
  onDone:   () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const age     = useRef(0)
  const done    = useRef(false)

  useFrame((_, delta) => {
    if (done.current) return
    age.current += delta
    if (!meshRef.current) return
    const t   = age.current / 0.6
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
/*  Camera auto-follow controller                                       */
/* ------------------------------------------------------------------ */

interface CameraFollowProps {
  playing:          boolean
  activeRegions:    Map<string, RegionData>
  globeRotationRef: React.MutableRefObject<number>
  controlsRef:      React.MutableRefObject<OrbitControlsImpl | null>
}

function CameraFollow({ playing, activeRegions, globeRotationRef, controlsRef }: CameraFollowProps) {
  const { camera } = useThree()

  useFrame((_, delta) => {
    if (!controlsRef.current || !playing) return

    const regionEntries = Array.from(activeRegions.entries())
    if (regionEntries.length === 0) return

    // Compute centroid of active region surface positions, accounting for globe rotation
    const centroid   = new THREE.Vector3()
    const rotMat     = new THREE.Matrix4().makeRotationY(globeRotationRef.current)

    regionEntries.forEach(([regionId]) => {
      const coords = REGION_COORDS[regionId]
      if (!coords) return
      const surfPos = latLngToVector3(coords[0], coords[1], GLOBE_RADIUS)
      surfPos.applyMatrix4(rotMat)
      centroid.add(surfPos)
    })
    centroid.divideScalar(regionEntries.length)

    // Pull camera target toward centroid (very gently, 0.01 lerp)
    const targetDir = centroid.clone().normalize().multiplyScalar(0.4)
    controlsRef.current.target.lerp(targetDir, 0.012)

    // Pull back as more regions activate (5.5 → 7.5)
    const regionCount   = regionEntries.length
    const targetDist    = 5.5 + (regionCount / 12) * 2.0
    const currentDist   = controlsRef.current.getDistance()
    const distDelta     = (targetDist - currentDist) * delta * 0.6

    if (Math.abs(distDelta) > 0.001) {
      // Move camera along its current direction
      const camDir = camera.position.clone().normalize()
      camera.position.addScaledVector(camDir, distDelta)
    }
  })

  return null
}

/* ------------------------------------------------------------------ */
/*  Main scene (inside Canvas)                                          */
/* ------------------------------------------------------------------ */

interface SceneProps {
  timeline:         TimelineFrame[]
  currentFrameIdx:  number
  playing:          boolean
  globeRotationRef: React.MutableRefObject<number>
}

function Scene({ timeline, currentFrameIdx, playing, globeRotationRef }: SceneProps) {
  const [arcs, setArcs]       = useState<ArcEntry[]>([])
  const [flashes, setFlashes] = useState<
    Array<{ id: string; pos: THREE.Vector3; color: THREE.Color }>
  >([])
  const processedFlows = useRef<Set<string>>(new Set())
  const arcsRef        = useRef<ArcEntry[]>([])
  const controlsRef    = useRef<OrbitControlsImpl | null>(null)
  const arcsGroupRef   = useRef<THREE.Group>(null)

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
      const toCoords   = REGION_COORDS[flow.to]
      if (!fromCoords || !toCoords) return

      const start = latLngToVector3(fromCoords[0], fromCoords[1], GLOBE_RADIUS)
      const end   = latLngToVector3(toCoords[0],   toCoords[1],   GLOBE_RADIUS)

      const curve     = createArcCurve(start, end, GLOBE_RADIUS)
      const color     = new THREE.Color(statusColor(flow.type))
      const allPoints = curve.getPoints(80)

      const entry: ArcEntry = {
        id: key,
        curve,
        color,
        progress:   0,
        age:        0,
        allPoints,
        frameIndex: currentFrameIdx,
      }

      arcsRef.current = [...arcsRef.current.slice(-MAX_ARCS + 1), entry]
      added = true
    })

    if (added) setArcs([...arcsRef.current])
  }, [currentFrameIdx, frame.flows, globeRotationRef])

  useFrame((_, delta) => {
    // Sync arcs group rotation with globe
    if (arcsGroupRef.current) {
      arcsGroupRef.current.rotation.y = globeRotationRef.current
    }

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
      // Arc is fully drawn — accumulate age but NEVER remove it
      const newAge = arc.age + delta
      changed = true
      return { ...arc, age: newAge }
    })

    // Arcs persist permanently — no removal based on age
    if (changed) setArcs([...arcsRef.current])
  })

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]}   intensity={0.8} color="#4477AA" />
      <pointLight position={[-10, -5, -5]}  intensity={0.4} color="#221133" />
      <pointLight position={[0, 8, 0]}      intensity={0.3} color="#334488" />

      <Stars radius={60} depth={50} count={1500} factor={3} saturation={0.2} fade speed={0.5} />

      <GlobeMesh rotationRef={globeRotationRef} />

      <RegionMarkers
        activeRegions={activeRegions}
        globeRotationRef={globeRotationRef}
      />

      <TacticalMarkerLayer
        activeRegions={activeRegions}
        globeRotationRef={globeRotationRef}
      />

      {/* Arcs and flashes rotate with the globe */}
      <group ref={arcsGroupRef}>
        {arcs.filter((arc) => arc.frameIndex <= currentFrameIdx).map((arc) => (
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
      </group>

      <CameraFollow
        playing={playing}
        activeRegions={activeRegions}
        globeRotationRef={globeRotationRef}
        controlsRef={controlsRef}
      />

      <OrbitControls
        ref={(c: OrbitControlsImpl | null) => {
          controlsRef.current = c
        }}
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.4}
        zoomSpeed={0.6}
        minDistance={3.0}
        maxDistance={10}
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
  playing:  boolean
  speed:    number
}

export function PropagationGlobe({ timeline, storyHeadline }: PropagationGlobeProps) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [playing,  setPlaying]  = useState(true)
  const [speed,    setSpeed]    = useState(1)
  const rafRef        = useRef<number | null>(null)
  const lastTimeRef   = useRef<number | null>(null)
  const stateRef      = useRef<PlaybackState>({ frameIdx: 0, progress: 0, playing: true, speed: 1 })
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
        const newProgress   = pr + (delta * sp) / frameDuration

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

  const frame         = timeline[Math.min(frameIdx, timeline.length - 1)]
  const activeRegions = frame
    ? frame.regions.filter((r) => r.status !== 'silent').slice(0, 8)
    : []

  // Compute initial camera position looking at the origin region, zoomed out
  const cameraStart = useMemo(() => {
    const originRegion = timeline[0]?.regions?.[0]?.region_id ?? 'us'
    const originCoords = REGION_COORDS[originRegion] ?? [39.8, -98.5]
    const originPos    = latLngToVector3(originCoords[0], originCoords[1], GLOBE_RADIUS)
    const dir          = originPos.clone().normalize()
    return [dir.x * 5.5, dir.y * 5.5 + 1, dir.z * 5.5] as [number, number, number]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- empty state ---- */
  if (limited) {
    return (
      <div
        style={{
          width:           '100%',
          aspectRatio:     '16/9',
          maxHeight:       '500px',
          background:      '#0A0A0B',
          border:          '1px solid #1e1e1e',
          borderRadius:    '10px',
          display:         'flex',
          flexDirection:   'column',
          alignItems:      'center',
          justifyContent:  'center',
          gap:             '12px',
        }}
      >
        <div
          style={{
            width:        '80px',
            height:       '80px',
            borderRadius: '50%',
            background:   'radial-gradient(circle at 35% 35%, #1A1A2E, #0A0A0B)',
            border:       '1px solid #2A2A2E',
            boxShadow:    '0 0 30px rgba(42, 157, 143, 0.1)',
          }}
        />
        <p
          style={{
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize:   '12px',
            color:      '#5C5A56',
            textAlign:  'center',
            margin:     0,
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
        position:   'relative',
        width:      '100%',
        background: '#0A0A0B',
        border:     '1px solid #1e1e1e',
        borderRadius: '10px',
        overflow:   'hidden',
        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
      }}
    >
      {/* Story headline label */}
      <div
        style={{
          position:       'absolute',
          top:            '14px',
          left:           '16px',
          zIndex:         10,
          maxWidth:       '55%',
          pointerEvents:  'none',
        }}
      >
        <div
          style={{
            fontSize:      '9px',
            fontWeight:    600,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color:         '#5C5A56',
            marginBottom:  '4px',
          }}
        >
          Story Propagation
        </div>
        <div
          style={{
            fontSize:   '12px',
            fontWeight: 600,
            color:      '#E8E6E3',
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
            position:      'absolute',
            top:           '14px',
            right:         '16px',
            zIndex:        10,
            textAlign:     'right',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize:   '22px',
              fontWeight: 600,
              color:      '#2A9D8F',
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
          camera={{ position: cameraStart, fov: 45, near: 0.1, far: 200 }}
          style={{ background: '#0A0A0B' }}
          gl={{ antialias: true, alpha: false }}
        >
          <Scene
            timeline={timeline}
            currentFrameIdx={frameIdx}
            playing={playing}
            globeRotationRef={globeRotationRef}
          />
        </Canvas>
      </div>

      {/* Legend */}
      <div
        style={{
          position:      'absolute',
          bottom:        '76px',
          left:          '16px',
          zIndex:        10,
          display:       'flex',
          flexDirection: 'column',
          gap:           '5px',
          pointerEvents: 'none',
        }}
      >
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display:      'inline-block',
                width:        '7px',
                height:       '7px',
                borderRadius: '50%',
                background:   statusColor(key),
                flexShrink:   0,
              }}
            />
            <span
              style={{
                fontSize:      '9px',
                color:         '#5C5A56',
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
            position:   'absolute',
            bottom:     '76px',
            right:      '16px',
            zIndex:     10,
            width:      '200px',
            background: 'rgba(10, 10, 11, 0.88)',
            border:     '1px solid #1e1e1e',
            borderRadius: '6px',
            padding:    '10px 12px',
          }}
        >
          <div
            style={{
              fontSize:      '9px',
              fontWeight:    600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color:         '#5C5A56',
              marginBottom:  '8px',
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
                      display:      'inline-block',
                      width:        '6px',
                      height:       '6px',
                      borderRadius: '50%',
                      background:   statusColor(r.status),
                      flexShrink:   0,
                    }}
                  />
                  <span
                    style={{
                      fontSize:     '10px',
                      fontWeight:   600,
                      color:        '#B0ADA5',
                      flex:         1,
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
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
                      fontSize:          '9px',
                      fontStyle:         'italic',
                      color:             '#5C5A56',
                      marginTop:         '2px',
                      marginLeft:        '12px',
                      lineHeight:        1.35,
                      overflow:          'hidden',
                      display:           '-webkit-box',
                      WebkitLineClamp:   2,
                      WebkitBoxOrient:   'vertical',
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
                marginTop:  '10px',
                paddingTop: '8px',
                borderTop:  '1px solid #1e1e1e',
                fontSize:   '9px',
                color:      '#5C5A56',
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
          position:   'absolute',
          bottom:     0,
          left:       0,
          right:      0,
          zIndex:     10,
          background: 'rgba(10, 10, 11, 0.92)',
          borderTop:  '1px solid #1e1e1e',
          padding:    '10px 16px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            style={{
              background:  'none',
              border:      '1px solid #2A2A2E',
              borderRadius: '4px',
              color:       '#B0ADA5',
              fontSize:    '11px',
              padding:     '4px 10px',
              cursor:      'pointer',
              fontFamily:  'var(--font-mono, monospace)',
              flexShrink:  0,
              lineHeight:  1.4,
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
              flex:        1,
              accentColor: '#2A9D8F',
              height:      '4px',
              cursor:      'pointer',
            }}
          />

          {/* Current hour */}
          <span
            style={{
              fontSize:   '10px',
              color:      '#5C5A56',
              flexShrink: 0,
              minWidth:   '44px',
              textAlign:  'right',
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
                  background:   speed === s ? '#2A9D8F' : 'none',
                  border:       `1px solid ${speed === s ? '#2A9D8F' : '#2A2A2E'}`,
                  borderRadius: '3px',
                  color:        speed === s ? '#0A0A0B' : '#5C5A56',
                  fontSize:     '9px',
                  padding:      '3px 6px',
                  cursor:       'pointer',
                  fontFamily:   'var(--font-mono, monospace)',
                  fontWeight:   speed === s ? 700 : 400,
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
            display:        'flex',
            justifyContent: 'space-between',
            marginTop:      '6px',
            paddingLeft:    '38px',
            paddingRight:   '90px',
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
                width:      '1px',
                height:     i === frameIdx ? '8px' : '4px',
                background: i === frameIdx ? '#2A9D8F' : '#2A2A2E',
                transition: 'height 150ms ease, background 150ms ease',
                cursor:     'pointer',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
