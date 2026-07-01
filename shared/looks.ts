export interface LookPreset {
  id: string
  name: string
  defaultStrength: number
  description: string
}

export const LOOKS: LookPreset[] = [
  { id: 'off', name: 'Off', defaultStrength: 0, description: 'Raw image, no LUT' },
  { id: 'cinematic', name: 'Cinematic', defaultStrength: 0.7, description: 'Warm shadows, cooler highs' },
  { id: 'intense', name: 'Intense', defaultStrength: 0.65, description: 'Punchy contrast and saturation' },
  { id: 'heartfelt', name: 'Heartfelt', defaultStrength: 0.55, description: 'Soft warm highlights' },
  { id: 'clean', name: 'Clean', defaultStrength: 0.45, description: 'Neutral polished baseline' },
  { id: 'noir', name: 'Noir', defaultStrength: 0.6, description: 'Low-colour dramatic monochrome' },
  { id: 'gold', name: 'Gold', defaultStrength: 0.6, description: 'Motivational amber warmth' }
]

export const LOOK_IDS = LOOKS.map((l) => l.id)

export function lookById(id?: string | null): LookPreset {
  const key = (id ?? '').trim().toLowerCase()
  return LOOKS.find((l) => l.id === key) ?? LOOKS[0]
}
