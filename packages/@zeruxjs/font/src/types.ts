export interface FontFaceOptions { family: string; src: string; weight?: string | number; style?: string; display?: 'auto'|'block'|'swap'|'fallback'|'optional'; format?: string; unicodeRange?: string }
export interface FontSource { url: string; format?: string }
export interface FontDefinition extends Omit<FontFaceOptions,'src'|'format'> { sources: FontSource[]; stretch?: string; featureSettings?: string; variationSettings?: string }
