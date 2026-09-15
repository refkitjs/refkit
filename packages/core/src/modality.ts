export const MODALITIES = ['image', 'video', 'audio', 'text'] as const
export type Modality = (typeof MODALITIES)[number]
