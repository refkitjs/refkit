import { factsFor, type LicenseId } from './license'

export interface Attribution {
  required: boolean
  text?: string
  html?: string
}

export interface AttributionInput {
  license: LicenseId
  /** Precise CC version for family ids; appended to the license name in the credit line. */
  licenseVersion?: string
  canonicalUrl: string
  author?: string
  title?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Mechanically derive attribution from license + author + title + canonicalUrl, so
// satellites pass fields (not hand-written strings) and credit lines stay consistent.
export function buildAttribution(input: AttributionInput): Attribution {
  const facts = factsFor(input.license)
  if (!facts.attributionRequired) return { required: false }

  const author = input.author ?? 'Unknown author'
  const licenseLabel = input.licenseVersion ? `${input.license} ${input.licenseVersion}` : input.license
  const titlePart = input.title ? `"${input.title}" ` : ''
  const text = `${titlePart}by ${author} is licensed under ${licenseLabel}. Source: ${input.canonicalUrl}`

  const url = escapeHtml(input.canonicalUrl)
  const titleHtml = input.title ? `&quot;${escapeHtml(input.title)}&quot; ` : ''
  const html = `${titleHtml}by ${escapeHtml(author)} is licensed under ${escapeHtml(licenseLabel)}. <a href="${url}">Source</a>`

  return { required: true, text, html }
}
