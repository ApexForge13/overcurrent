'use client'

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
// topojson-client has no bundled type declarations; import with explicit typing
import * as topojsonClient from 'topojson-client'
type TopoFeatureFn = (
  topology: unknown,
  object: unknown
) => { features: Array<{ id?: string | number; geometry: { type: string; coordinates: number[][][][] | number[][][] } }> }
const topoFeature = (topojsonClient as unknown as { feature: TopoFeatureFn }).feature
import { numericIdToIso2 } from '@/lib/topojson-iso2'
import { expandRegionKey } from '@/lib/map-regions'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface TimelineFrame {
  hour: number
  timestamp?: string
  label: string
  description: string
  regions: Array<{
    region_id: string
    status: string
    border_status?: string
    coverage_volume: number
    dominant_quote: string
    outlet_count: number
    key_outlets: string[]
  }>
  flows: Array<{
    from: string
    to: string
    type: string
    fromType?: string
    toType?: string
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

// ═══════════════════════════════════════════════════════════════════════
// THREE TIERS of visual treatment:
//   Tier 1: NEVER MAPPED       → INACTIVE_COLOR, near-invisible wireframe
//   Tier 2: MAPPED, NO COVERAGE → muted gray, VISIBLE (absence is a finding)
//   Tier 3: ACTIVE COVERAGE    → full color per status
// ═══════════════════════════════════════════════════════════════════════
const STATUS_COLORS: Record<string, string> = {
  // Tier 3 — active coverage
  original:           '#2A9D8F',  // teal-green
  wire_copy:          '#378ADD',  // blue
  reframed:           '#F4A261',  // amber
  contradicted:       '#E24B4A',  // red
  adjacent_coverage:  '#8B5CF6',  // purple — tangential/sidelong coverage
  displaced_coverage: '#EC4899',  // pink — covered something else instead

  // Tier 2 — mapped but silent (VISIBLE muted gray — a finding of absence)
  no_coverage:        '#6B6B78',  // medium gray
  silent:             '#6B6B78',  // alias to no_coverage gray
}

// Tier 1 — never mapped (outside our analysis scope)
const INACTIVE_COLOR = '#1A1A2E'
const INACTIVE_OPACITY = 0.06

const STATUS_LABELS: Record<string, string> = {
  original:            'Original',
  wire_copy:           'Wire Copy',
  reframed:            'Reframed',
  contradicted:        'Contradicted',
  adjacent_coverage:   'Adjacent Coverage',
  displaced_coverage:  'Displaced',
  no_coverage:         'No Coverage',
}

const MAX_ARCS = 50

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

function createArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments: number = 80
): THREE.Vector3[] {
  // Great-circle interpolation with height offset — works for ANY distance
  // Slerp along the sphere surface, then push each point outward by arc height
  const points: THREE.Vector3[] = []
  const startNorm = start.clone().normalize()
  const endNorm = end.clone().normalize()

  // Angle between the two points on the sphere
  const angle = startNorm.angleTo(endNorm)

  // Arc height peaks at midpoint, proportional to angle (longer = higher)
  const maxHeight = Math.min(angle * 0.4, 0.6) * radius * 0.5

  for (let i = 0; i <= segments; i++) {
    const t = i / segments

    // Slerp (spherical linear interpolation) between start and end
    const point = new THREE.Vector3()

    if (angle < 0.001) {
      // Points are basically the same — just lerp
      point.lerpVectors(start, end, t)
    } else {
      // Proper slerp
      const sinAngle = Math.sin(angle)
      const a = Math.sin((1 - t) * angle) / sinAngle
      const b = Math.sin(t * angle) / sinAngle
      point.x = startNorm.x * a + endNorm.x * b
      point.y = startNorm.y * a + endNorm.y * b
      point.z = startNorm.z * a + endNorm.z * b
    }

    // Push outward from globe center — base radius + arc height
    // Height follows a sine curve: peaks at midpoint
    const heightFactor = Math.sin(t * Math.PI)
    const pointRadius = radius + maxHeight * heightFactor + 0.02 // 0.02 offset so it's above surface
    point.normalize().multiplyScalar(pointRadius)

    points.push(point)
  }

  return points
}

/** Normalize any status string to a STATUS_COLORS key. Dead simple. */
function normalizeStatus(status: string): string {
  if (!status) return 'silent'
  const s = status.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (s in STATUS_COLORS) return s
  // Handle common variants
  if (s.includes('wire') || s.includes('copy')) return 'wire_copy'
  if (s.includes('refram')) return 'reframed'
  if (s.includes('contra')) return 'contradicted'
  if (s.includes('origin')) return 'original'
  if (s.includes('silent') || s.includes('no_') || s.includes('adjacent') || s.includes('displace')) return 'silent'
  return 'silent'
}

/** Get the hex color for any status string. Always returns a valid color. */
function statusColor(status: string): string {
  return STATUS_COLORS[normalizeStatus(status)] || STATUS_COLORS.silent
}

/** Is this status "active" (should show color on the map)? */
/**
 * Status represents active substantive coverage of the story.
 * These countries get full color fills (Tier 3).
 */
function hasSubstantiveCoverage(status: string): boolean {
  const n = normalizeStatus(status)
  return (
    n === 'original' ||
    n === 'wire_copy' ||
    n === 'reframed' ||
    n === 'contradicted' ||
    n === 'adjacent_coverage' ||
    n === 'displaced_coverage'
  )
}

/**
 * Status represents a country that was analyzed and found to have no
 * substantive coverage. These countries get muted gray fills (Tier 2).
 */
function isMappedSilent(status: string): boolean {
  const n = normalizeStatus(status)
  return n === 'no_coverage' || n === 'silent'
}

/**
 * Any classification status — active or silent. Tier 2 or Tier 3.
 * Anything NOT classified is Tier 1 (never mapped, near-invisible).
 */
function isClassified(status: string): boolean {
  return hasSubstantiveCoverage(status) || isMappedSilent(status)
}

/* ------------------------------------------------------------------ */
/*  Country borders — loaded from Natural Earth 110m TopoJSON          */
/* ------------------------------------------------------------------ */

/** Map TopoJSON ISO 3166-1 numeric country IDs to region_id. */
const COUNTRY_ID_TO_REGION: Record<string, string> = {
  // North America
  '840': 'us', '124': 'us', '484': 'mx',
  // Latin America
  '032': 'la', '076': 'la', '152': 'la', '170': 'la', '218': 'la',
  '604': 'la', '858': 'la', '862': 'la', '192': 'la', '068': 'la',
  '600': 'la', '328': 'la', '740': 'la', '780': 'la',
  // Central America / Caribbean
  '084': 'la', // Belize
  '188': 'la', // Costa Rica
  '222': 'la', // El Salvador
  '320': 'la', // Guatemala
  '340': 'la', // Honduras
  '558': 'la', // Nicaragua
  '591': 'la', // Panama
  '214': 'la', // Dominican Republic
  '332': 'la', // Haiti
  '388': 'la', // Jamaica
  '044': 'la', // Bahamas
  '052': 'la', // Barbados
  // Europe
  '826': 'uk', '372': 'uk',
  '276': 'eu', '250': 'eu', '724': 'eu', '380': 'eu', '528': 'eu',
  '056': 'eu', '040': 'eu', '752': 'eu', '578': 'eu', '208': 'eu',
  '246': 'eu', '616': 'eu', '203': 'eu', '642': 'eu', '348': 'eu',
  '756': 'eu', '620': 'eu', '300': 'eu', '804': 'eu',
  '196': 'eu', // Cyprus
  // Russia
  '643': 'ru',
  // Turkey
  '792': 'tr',
  // Middle East
  '682': 'me', '784': 'me', '634': 'me', '414': 'me', '048': 'me',
  '512': 'me', '368': 'me', '400': 'me', '422': 'me', '760': 'me',
  '818': 'me', '887': 'me',
  // Iran
  '364': 'ir',
  // Israel / Palestine
  '376': 'il',
  '275': 'il', // Palestine
  // Pakistan
  '586': 'pk', '004': 'pk',
  // India / South Asia
  '356': 'in', '050': 'in', '144': 'in', '524': 'in',
  '064': 'in', // Bhutan
  // China
  '156': 'cn', '344': 'cn', '158': 'cn',
  '496': 'cn', // Mongolia
  // Japan
  '392': 'jp',
  // South Korea / North Korea
  '410': 'kr',
  '408': 'kr', // North Korea
  // Southeast Asia
  '702': 'sea', '458': 'sea', '764': 'sea', '704': 'sea',
  '608': 'sea', '360': 'sea', '104': 'sea',
  '418': 'sea', // Laos
  '116': 'sea', // Cambodia
  '096': 'sea', // Brunei
  '626': 'sea', // Timor-Leste
  // Australia / Oceania
  '036': 'au', '554': 'au',
  '598': 'au', // Papua New Guinea
  '242': 'au', // Fiji
  // Africa
  '710': 'af', '566': 'af', '404': 'af', '231': 'af', '288': 'af',
  '834': 'af', '012': 'af', '508': 'af', '180': 'af',
  '800': 'af', '854': 'af', '686': 'af',
  '024': 'af', // Angola
  '072': 'af', // Botswana
  '108': 'af', // Burundi
  '120': 'af', // Cameroon
  '140': 'af', // Central African Republic
  '148': 'af', // Chad
  '174': 'af', // Comoros
  '178': 'af', // Congo
  '262': 'af', // Djibouti
  '226': 'af', // Equatorial Guinea
  '232': 'af', // Eritrea
  '748': 'af', // Eswatini
  '266': 'af', // Gabon
  '270': 'af', // Gambia
  '324': 'af', // Guinea
  '624': 'af', // Guinea-Bissau
  '384': 'af', // Ivory Coast
  '426': 'af', // Lesotho
  '430': 'af', // Liberia
  '434': 'af', // Libya
  '450': 'af', // Madagascar
  '454': 'af', // Malawi
  '466': 'af', // Mali
  '478': 'af', // Mauritania
  '480': 'af', // Mauritius
  '504': 'af', // Morocco
  '516': 'af', // Namibia
  '562': 'af', // Niger
  '646': 'af', // Rwanda
  '678': 'af', // Sao Tome
  '694': 'af', // Sierra Leone
  '706': 'af', // Somalia
  '728': 'af', // South Sudan
  '729': 'af', // Sudan
  '768': 'af', // Togo
  '788': 'af', // Tunisia
  '894': 'af', // Zambia
  '716': 'af', // Zimbabwe
}

function getRegionForCountryId(id: string | number): string {
  return COUNTRY_ID_TO_REGION[String(id)] || ''
}

interface CountryLine {
  line:     THREE.Line
  regionId: string   // Now stores ISO2 country code (e.g. 'HU', 'US', 'DE')
}

interface CountryFill {
  mesh:     THREE.Mesh
  regionId: string   // Now stores ISO2 country code
}

/** Skip rings that cross the antimeridian — their flat 2D triangulation breaks on the sphere. */
function ringCrossesAntimeridian(ring: number[][]): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    const lngA = ring[i][0]
    const lngB = ring[i + 1][0]
    if (Math.abs(lngA - lngB) > 180) return true
  }
  return false
}

function createCountryFillMesh(ring: number[][], status: string | null): THREE.Mesh | null {
  if (ring.length < 3) return null
  if (ringCrossesAntimeridian(ring)) return null

  // Build a flat 2D shape from lng/lat coordinates
  const shape = new THREE.Shape()
  shape.moveTo(ring[0][0], ring[0][1]) // lng, lat
  for (let i = 1; i < ring.length; i++) {
    shape.lineTo(ring[i][0], ring[i][1])
  }
  shape.closePath()

  const shapeGeo = new THREE.ShapeGeometry(shape, 1)

  // Remap flat vertices onto the sphere surface
  const pos = shapeGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const lng = pos.getX(i)
    const lat = pos.getY(i)
    const v = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.003)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  shapeGeo.computeVertexNormals()

  const color   = status && STATUS_COLORS[status] ? STATUS_COLORS[status] : '#2A2A3E'
  const opacity = status && status !== 'silent' ? 0.2 : 0.03

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  })

  return new THREE.Mesh(shapeGeo, mat)
}

interface CountryBordersProps {
  globeRotation:    React.MutableRefObject<number>
  activeRegions?:   Map<string, { status: string; border_status?: string }>
  /** How each region RECEIVED the story — computed from flows */
  borderStatuses?:  Map<string, string>
}

function CountryBorders({ globeRotation, activeRegions, borderStatuses }: CountryBordersProps) {
  const groupRef    = useRef<THREE.Group>(null)
  const [countryLines, setCountryLines] = useState<CountryLine[]>([])
  const [fillMeshes, setFillMeshes]     = useState<CountryFill[]>([])

  useEffect(() => {
    fetch('/world-110m.json')
      .then((r) => r.json())
      .then((topology: unknown) => {
        // The Natural Earth 110m file exposes "countries" as the geometry object
        const topoAny = topology as Record<string, unknown>
        const objects = topoAny.objects as Record<string, unknown>
        const objectKey = objects.countries ? 'countries' : Object.keys(objects)[0]
        const countries = topoFeature(topology, objects[objectKey])

        const built: CountryLine[] = []
        const fills: CountryFill[] = []

        for (const feat of countries.features) {
          const geom = feat.geometry
          if (!geom) continue

          // Map TopoJSON numeric ID → ISO alpha-2 country code
          const regionId = numericIdToIso2(feat.id ?? '') ?? ''

          // Outer ring only — Polygon gives one ring, MultiPolygon gives one per sub-polygon
          const rings: number[][][] =
            geom.type === 'Polygon'
              ? [(geom.coordinates as number[][][])[0]]
              : geom.type === 'MultiPolygon'
              ? (geom.coordinates as number[][][][]).map((poly) => poly[0])
              : []

          for (const ring of rings) {
            if (ring.length < 3) continue

            // Border line
            const points: THREE.Vector3[] = ring.map(([lng, lat]) =>
              latLngToVector3(lat as number, lng as number, GLOBE_RADIUS + 0.005)
            )
            const mat = new THREE.LineBasicMaterial({
              color:       '#8A8A9E',
              transparent: true,
              opacity:     0.6,
            })
            const geo = new THREE.BufferGeometry().setFromPoints(points)
            built.push({ line: new THREE.Line(geo, mat), regionId })

            // Fill mesh
            const fillMesh = createCountryFillMesh(ring, null)
            if (fillMesh) fills.push({ mesh: fillMesh, regionId })
          }
        }

        setCountryLines(built)
        setFillMeshes(fills)
      })
      .catch((err) => console.warn('Failed to load country borders:', err))
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // THE FOUR RULES — the entire color system
  // Rule 1: BORDER = how they RECEIVED the story (borderStatuses map)
  // Rule 2: FILL   = how they REPORTED the story (region's own status)
  // Rule 3: Inactive countries = nearly invisible
  // Rule 4: Only 4 active colors: green, blue, yellow, red
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Debug: log what data each active region has
    if (activeRegions && activeRegions.size > 0) {
      const debugEntries: string[] = []
      activeRegions.forEach((data, rid) => {
        const norm = normalizeStatus(data.status)
        const tier = hasSubstantiveCoverage(data.status) ? 'T3' : isMappedSilent(data.status) ? 'T2' : 'T1'
        const border = borderStatuses?.get(rid) || data.status
        debugEntries.push(`${rid}: status=${data.status}(${norm}) border=${border} ${tier}`)
      })
      console.log('[Globe] Region data:', debugEntries.join(' | '))
    }

    // BORDERS — three-tier treatment
    countryLines.forEach(({ line, regionId }) => {
      const mat = line.material as THREE.LineBasicMaterial
      const regionData = activeRegions?.get(regionId)

      if (regionData && hasSubstantiveCoverage(regionData.status)) {
        // Tier 3: active coverage — border = how they RECEIVED
        const received = borderStatuses?.get(regionId) || regionData.status
        mat.color.set(statusColor(received))
        mat.opacity = 0.85
        mat.linewidth = 2
      } else if (regionData && isMappedSilent(regionData.status)) {
        // Tier 2: mapped but silent — visible muted gray
        mat.color.set(STATUS_COLORS.no_coverage)
        mat.opacity = 0.35
      } else {
        // Tier 1: never mapped — near-invisible wireframe
        mat.color.set(INACTIVE_COLOR)
        mat.opacity = INACTIVE_OPACITY
      }
      mat.needsUpdate = true
    })

    // FILLS — three-tier treatment
    fillMeshes.forEach(({ mesh, regionId }) => {
      const mat = mesh.material as THREE.MeshBasicMaterial
      const regionData = activeRegions?.get(regionId)

      if (regionData && hasSubstantiveCoverage(regionData.status)) {
        // Tier 3: active coverage — fill = how they REPORTED
        // Exception: if border_status is 'original', fill is also 'original'
        // (origin country can't reframe its own story)
        const border = borderStatuses?.get(regionId)
        const fillStatus = (border && normalizeStatus(border) === 'original') ? 'original' : regionData.status
        mat.color.set(statusColor(fillStatus))
        mat.opacity = normalizeStatus(fillStatus) === 'original' ? 0.55 : 0.40
      } else if (regionData && isMappedSilent(regionData.status)) {
        // Tier 2: mapped but silent — visible muted gray fill (absence is a finding)
        mat.color.set(STATUS_COLORS.no_coverage)
        mat.opacity = 0.18
      } else {
        // Tier 1: never mapped — essentially invisible
        mat.color.set(INACTIVE_COLOR)
        mat.opacity = 0.02
      }
      mat.needsUpdate = true
    })
  }, [activeRegions, borderStatuses, countryLines, fillMeshes])

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = globeRotation.current
    }
  })

  return (
    <group ref={groupRef}>
      {fillMeshes.map(({ mesh }, i) => (
        <primitive key={`fill-${i}`} object={mesh} />
      ))}
      {countryLines.map(({ line }, i) => (
        <primitive key={`line-${i}`} object={line} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Globe mesh with city dots and grid lines                           */
/* ------------------------------------------------------------------ */

function GlobeMesh({ rotationRef }: { rotationRef: React.MutableRefObject<number> }) {
  const globeRef      = useRef<THREE.Mesh>(null)
  const glowRef       = useRef<THREE.Mesh>(null)
  const dotsRef       = useRef<THREE.Group>(null)
  const gridRef       = useRef<THREE.Group>(null)

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

  useFrame((_, delta) => {
    const dr = delta * 0.05
    rotationRef.current += dr
    if (globeRef.current)     globeRef.current.rotation.y     += dr
    if (glowRef.current)      glowRef.current.rotation.y      += dr
    if (dotsRef.current)      dotsRef.current.rotation.y      += dr
    if (gridRef.current)      gridRef.current.rotation.y      += dr
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
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Tactical marker — HUD-style rectangular target box                 */
/* ------------------------------------------------------------------ */

interface RegionData {
  status:          string  // Fill color (how they reported it)
  border_status?:  string  // Border color (how they received it) — falls back to status
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
  const color        = isActive ? statusColor(data!.border_status ?? data!.status) : '#333344'
  const label        = REGION_LABELS[regionId] ?? regionId.toUpperCase()
  const isMobile     = typeof window !== 'undefined' && window.innerWidth < 640
  const showFullDetail = activeCount < 5 && !isMobile
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
      distanceFactor={isMobile ? 8 : 6}
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
          fontSize:      isMobile ? '6px' : '8px',
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

  // Helper: find the first active country in a region's expansion to determine
  // the region marker's color/status
  const findRegionData = useCallback((regionId: string) => {
    // Try the region key directly first (works for single-country keys like 'us' → 'US')
    const countries = expandRegionKey(regionId)
    for (const iso2 of countries) {
      const data = activeRegions.get(iso2)
      if (data && normalizeStatus(data.status) !== 'silent') return data
    }
    return null
  }, [activeRegions])

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = globeRotationRef.current
    }

    meshMap.current.forEach((mesh, regionId) => {
      const data     = findRegionData(regionId)
      const isActive = !!data
      const color    = new THREE.Color(statusColor(data?.border_status ?? data?.status ?? 'silent'))

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
        const baseScale = normalizeStatus(data?.border_status ?? data?.status ?? '') === 'original' ? 1.6 : 1.1
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
      {entries.map(([regionId, [lat, lng]]) => {
        const primaryPos = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.04)
        return (
          <group key={`region-${regionId}`}>
            {/* Primary pulse dot — color = region's own status */}
            <mesh
              position={primaryPos}
              ref={(el: THREE.Mesh | null) => {
                if (el) meshMap.current.set(regionId, el)
              }}
            >
              <sphereGeometry args={[0.02, 8, 8]} />
              <meshBasicMaterial color="#333340" transparent opacity={0.3} />
            </mesh>
          </group>
        )
      })}
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

  // Helper: find active data for a hybrid region key by checking its expanded countries
  const findRegionData = useCallback((regionId: string) => {
    const countries = expandRegionKey(regionId)
    for (const iso2 of countries) {
      const data = activeRegions.get(iso2)
      if (data && normalizeStatus(data.status) !== 'silent') return data
    }
    return undefined
  }, [activeRegions])

  return (
    <group ref={groupRef}>
      {entries.map(([regionId, [lat, lng]]) => (
        <TacticalMarker
          key={`marker-${regionId}`}
          regionId={regionId}
          lat={lat}
          lng={lng}
          data={findRegionData(regionId)}
          activeCount={activeCount}
          globeRotation={globeRotation}
        />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Compute secondary statuses from incoming flows                      */
/* ------------------------------------------------------------------ */

/**
 * For each region that is a DESTINATION of a flow, record the flow type as
 * the "secondary status" if it differs from the region's own primary status.
 * This enables dual coloring: primary dot = what a region reports,
 * secondary ring = what others say about it (contradiction / reframe).
 */
function computeSecondaryStatuses(
  flows: Array<{ from: string; to: string; type: string }>,
  activeRegions: Map<string, RegionData>
): Map<string, string> {
  const result = new Map<string, string>()
  for (const flow of flows) {
    // Expand flow destination (hybrid key) into ISO2 countries
    const destCountries = expandRegionKey(flow.to)
    for (const iso2 of destCountries) {
      const primaryStatus = activeRegions.get(iso2)?.status
      if (primaryStatus && flow.type !== primaryStatus) {
        if (!result.has(iso2) || flow.type === 'contradicted') {
          result.set(iso2, flow.type)
        }
      }
    }
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Auto-generate flows from region data                               */
/* ------------------------------------------------------------------ */

const NO_FLOW_STATUSES = new Set(['no_coverage', 'silent', 'adjacent_coverage', 'displaced_coverage'])

function generateFlowsFromRegions(frame: TimelineFrame): TimelineFrame['flows'] {
  // Filter out regions with no real coverage
  const regions = frame.regions.filter((r) => {
    const effectiveStatus = normalizeStatus(r.border_status ?? r.status)
    if (NO_FLOW_STATUSES.has(effectiveStatus)) return false
    return r.coverage_volume > 0 || r.outlet_count > 0
  })
  if (regions.length < 2) return frame.flows || []

  // Use origin if available, otherwise use the first region (highest coverage) as hub
  const origin = regions.find((r) => normalizeStatus(r.border_status ?? r.status) === 'original') || regions[0]

  const flows: TimelineFrame['flows'] = [...(frame.flows || [])]
  const existingFlowKeys = new Set(flows.map((f) => `${f.from}-${f.to}`))

  // Flow from origin to every other active region
  // fromType = origin's status (green), toType = destination's status
  for (const region of regions) {
    if (region.region_id === origin.region_id) continue
    const key = `${origin.region_id}-${region.region_id}`
    if (existingFlowKeys.has(key)) continue
    const fromStatus = normalizeStatus(origin.border_status ?? origin.status)
    const toStatus = normalizeStatus(region.border_status ?? region.status)
    flows.push({
      from: origin.region_id,
      to: region.region_id,
      type: toStatus,
      fromType: fromStatus,
      toType: toStatus,
    })
    existingFlowKeys.add(key)
  }

  // Cross-flows between ALL non-origin active regions.
  // Previous version required different statuses, which blocked flows when
  // most regions share the same status (e.g., all wire_copy). The visual
  // should show the web of information propagation between all active regions.
  for (let i = 0; i < regions.length; i++) {
    if (regions[i].region_id === origin.region_id) continue
    for (let j = i + 1; j < regions.length; j++) {
      if (regions[j].region_id === origin.region_id) continue
      const statusI = normalizeStatus(regions[i].border_status ?? regions[i].status)
      const statusJ = normalizeStatus(regions[j].border_status ?? regions[j].status)

      // Determine flow direction: wire_copy → reframed, or higher volume → lower
      const key = `${regions[i].region_id}-${regions[j].region_id}`
      const reverseKey = `${regions[j].region_id}-${regions[i].region_id}`
      if (existingFlowKeys.has(key) || existingFlowKeys.has(reverseKey)) continue

      // Direction: wire_copy sources flow toward reframed/contradicted destinations.
      // If same status, higher coverage_volume is the "from" (it spread the story further).
      let from = regions[i]
      let to = regions[j]
      if (statusI === statusJ) {
        // Same status — higher volume → lower volume
        if (regions[j].coverage_volume > regions[i].coverage_volume) {
          from = regions[j]
          to = regions[i]
        }
      } else if (statusJ === 'wire_copy' && statusI !== 'wire_copy') {
        from = regions[j]
        to = regions[i]
      }
      // else default: i → j (wire_copy or first listed flows to second)

      const fromS = normalizeStatus(from.border_status ?? from.status)
      const toS = normalizeStatus(to.border_status ?? to.status)
      flows.push({
        from: from.region_id,
        to: to.region_id,
        type: toS,
        fromType: fromS,
        toType: toS,
      })
      existingFlowKeys.add(`${from.region_id}-${to.region_id}`)
    }
  }

  return flows
}

/* ------------------------------------------------------------------ */
/*  Arc data                                                            */
/* ------------------------------------------------------------------ */

interface ArcEntry {
  id:         string
  color:      THREE.Color
  fromColor?: THREE.Color
  toColor?:   THREE.Color
  progress:   number
  age:        number
  allPoints:  THREE.Vector3[]
  frameIndex: number
}

/* ------------------------------------------------------------------ */
/*  Single arc rendered via TubeGeometry mesh                          */
/*  TubeGeometry creates a proper mesh — R3F renders it reliably.      */
/* ------------------------------------------------------------------ */

function ArcLine({ arc }: { arc: ArcEntry }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const meshRef = useRef<THREE.Mesh>(null)

  // Build tube geometry with gradient vertex colors
  const tube = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(arc.allPoints)
    const geo = new THREE.TubeGeometry(curve, 60, 0.008, 5, false)

    // Add gradient vertex colors: fromColor → toColor along the tube
    const fromColor = arc.fromColor ?? arc.color
    const toColor = arc.toColor ?? arc.color
    const count = geo.attributes.position.count
    const colors = new Float32Array(count * 3)
    const ringsPerSegment = 6  // radialSegments + 1
    const totalRings = 61      // tubularSegments + 1

    for (let i = 0; i < count; i++) {
      const ring = Math.floor(i / ringsPerSegment)
      const t = ring / (totalRings - 1)  // 0 at start, 1 at end
      colors[i * 3]     = fromColor.r + (toColor.r - fromColor.r) * t
      colors[i * 3 + 1] = fromColor.g + (toColor.g - fromColor.g) * t
      colors[i * 3 + 2] = fromColor.b + (toColor.b - fromColor.b) * t
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [arc.allPoints, arc.fromColor, arc.toColor, arc.color])

  useEffect(() => {
    return () => { tube.dispose() }
  }, [tube])

  // Show tube only when progress > 0, fade based on age
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.visible = arc.progress > 0.1
    }
    if (matRef.current) {
      if (arc.progress < 1) {
        matRef.current.opacity = 0.3 + arc.progress * 0.7
      } else {
        matRef.current.opacity = arc.age > 5 ? 0.3 : 0.6
      }
    }
  })

  return (
    <mesh ref={meshRef} geometry={tube} renderOrder={999} visible={false}>
      <meshBasicMaterial
        ref={matRef}
        vertexColors
        transparent
        opacity={0.6}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
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

  // ── CORE FIX: Expand region_id keys into per-country ISO2 maps ──
  // The timeline uses hybrid keys (eu, la, us, hu). The renderer colors
  // per-country polygons keyed by ISO2. Expand regional keys here so every
  // country polygon can look itself up directly.
  // Country-specific keys (hu, us, tr) override regional defaults (eu, la).
  const activeRegions = useMemo(() => {
    const map = new Map<string, typeof frame.regions[0]>()

    // Pass 1: expand regional (multi-country) keys
    for (const r of frame.regions) {
      const countries = expandRegionKey(r.region_id)
      if (countries.length > 1) {
        // Regional key → fan out to all member countries
        for (const iso2 of countries) {
          map.set(iso2, r)
        }
      }
    }

    // Pass 2: country-level keys override regional defaults
    for (const r of frame.regions) {
      const countries = expandRegionKey(r.region_id)
      if (countries.length === 1) {
        map.set(countries[0], r)
      }
    }

    return map
  }, [frame])

  // Auto-generate flows from region data, supplementing any AI-provided flows
  // (flows still use hybrid region_id keys for arc endpoints — that's fine
  // because REGION_COORDS maps hybrid keys to lat/lng)
  const allFlows = useMemo(() => generateFlowsFromRegions(frame), [frame])

  // Compute dual-status map: for each destination region, record the incoming
  // flow type if it differs from the region's own primary status.
  const secondaryStatuses = useMemo(
    () => computeSecondaryStatuses(allFlows, activeRegions),
    [allFlows, activeRegions]
  )

  // Expand border_status from timeline into per-country ISO2 map.
  // Country-level border_status overrides regional.
  const borderStatuses = useMemo(() => {
    const result = new Map<string, string>()
    // Pass 1: regional
    for (const r of frame.regions) {
      if (!r.border_status) continue
      const countries = expandRegionKey(r.region_id)
      if (countries.length > 1) {
        for (const iso2 of countries) result.set(iso2, r.border_status)
      }
    }
    // Pass 2: country-level overrides
    for (const r of frame.regions) {
      if (!r.border_status) continue
      const countries = expandRegionKey(r.region_id)
      if (countries.length === 1) result.set(countries[0], r.border_status)
    }
    return result
  }, [frame.regions])

  // When frame changes, spawn arcs for new flows
  useEffect(() => {
    const newFlows = allFlows.slice(0, MAX_ARCS)
    let added = false

    newFlows.forEach((flow, i) => {
      const key = `${currentFrameIdx}-${flow.from}-${flow.to}-${i}`
      if (processedFlows.current.has(key)) return
      processedFlows.current.add(key)

      // Skip silent/empty flows — they'd render as invisible black arcs
      const normType = normalizeStatus(flow.type || '')
      if (!normType || normType === 'silent' || normType === 'no_coverage') return

      const fromCoords = REGION_COORDS[flow.from]
      const toCoords   = REGION_COORDS[flow.to]
      if (!fromCoords || !toCoords) return

      const start = latLngToVector3(fromCoords[0], fromCoords[1], GLOBE_RADIUS)
      const end   = latLngToVector3(toCoords[0],   toCoords[1],   GLOBE_RADIUS)

      const fromType = normalizeStatus(flow.fromType ?? flow.type)
      const toType = normalizeStatus(flow.toType ?? flow.type)
      const color     = new THREE.Color(statusColor(fromType))
      const fromColor = new THREE.Color(statusColor(fromType))
      const toColor   = new THREE.Color(statusColor(toType))
      const allPoints = createArcPoints(start, end, GLOBE_RADIUS, 80)

      const entry: ArcEntry = {
        id: key,
        color,
        fromColor,
        toColor,
        progress:   0,
        age:        0,
        allPoints,
        frameIndex: currentFrameIdx,
      }

      arcsRef.current = [...arcsRef.current.slice(-MAX_ARCS + 1), entry]
      added = true
    })

    if (added) {
      console.log('[Globe] Created arcs. Total:', arcsRef.current.length)
      setArcs([...arcsRef.current])
    }
  }, [currentFrameIdx, allFlows, globeRotationRef])

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

      <CountryBorders
        globeRotation={globeRotationRef}
        activeRegions={activeRegions}
        borderStatuses={borderStatuses}
      />

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
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
    ? frame.regions.filter((r) => r.status !== 'silent')
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
        minHeight:  '700px',
        background: '#0A0A0B',
        border:     '1px solid #1e1e1e',
        borderRadius: '10px',
        overflow:   'visible',
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
            {frame.label || `+${frame.hour}h`}
          </div>
          <div style={{ fontSize: '10px', color: '#5C5A56', marginTop: '2px' }}>
            {frame.description?.substring(0, 40) || frame.label}
          </div>
        </div>
      )}

      {/* Canvas — shifted left so sidebar doesn't cover the globe */}
      <div style={{ width: '130%', marginLeft: '-15%', aspectRatio: '16/10', maxHeight: '650px' }}>
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

      {/* Legend — positioned inside map above timeline */}
      <div
        style={{
          position:      'absolute',
          bottom:        '64px',
          left:          '16px',
          zIndex:        10,
          pointerEvents: 'none',
        }}
      >
        {Object.entries(STATUS_LABELS).map(([key, label]) => {
          const isSilent = key === 'no_coverage' || key === 'silent'
          return (
            <div key={key}>
              {isSilent && (
                <div style={{ height: '1px', background: '#2A2A2E', marginTop: '4px', marginBottom: '4px', opacity: 0.6 }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', opacity: isSilent ? 0.7 : 1 }}>
                <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: statusColor(key), flexShrink: 0 }} />
                <span style={{ fontSize: '9px', color: '#5C5A56', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
            </div>
          )
        })}
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #2A2A2E' }}>
          <div style={{ fontSize: '8px', color: '#4A4A56', lineHeight: 1.5 }}>
            <span style={{ color: '#6A6A7E' }}>Border</span> = how they received the story
          </div>
          <div style={{ fontSize: '8px', color: '#4A4A56', lineHeight: 1.5 }}>
            <span style={{ color: '#6A6A7E' }}>Fill</span> = how they reported it
          </div>
        </div>
      </div>

      {/* Active regions info panel */}
      {/* Sidebar toggle button */}
      {activeRegions.length > 0 && (
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          style={{
            position:     'absolute',
            top:          '16px',
            right:        sidebarOpen ? '244px' : '16px',
            zIndex:       11,
            background:   'rgba(10, 10, 11, 0.88)',
            border:       '1px solid #1e1e1e',
            borderRadius: '4px',
            color:        '#5C5A56',
            fontSize:     '11px',
            padding:      '4px 8px',
            cursor:       'pointer',
            fontFamily:   'var(--font-mono, monospace)',
            transition:   'right 0.2s ease',
          }}
        >
          {sidebarOpen ? '\u25B6' : '\u25C0'} {sidebarOpen ? 'Hide' : 'Regions'}
        </button>
      )}

      {activeRegions.length > 0 && sidebarOpen && (
        <div
          style={{
            position:   'absolute',
            top:        '16px',
            right:      '16px',
            bottom:     '76px',
            zIndex:     10,
            width:      '220px',
            background: 'rgba(10, 10, 11, 0.88)',
            border:     '1px solid #1e1e1e',
            borderRadius: '6px',
            padding:    '10px 12px',
            overflowY:  'auto',
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
                      background:   statusColor(r.border_status ?? r.status),
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
            {frame?.label || `+${frame?.hour ?? 0}h`}
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
              title={f.label || `+${f.hour}h`}
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
