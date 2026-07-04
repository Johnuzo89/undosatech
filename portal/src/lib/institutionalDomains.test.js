import { describe, it, expect } from 'vitest'
import { isInstitutional, INSTANT_DOMAINS } from './institutionalDomains'

describe('isInstitutional', () => {
  it('accepts UK academic and NHS domains', () => {
    expect(isInstitutional('a.researcher@dundee.ac.uk')).toBe(true)
    expect(isInstitutional('nurse@nhs.net')).toBe(true)
    expect(isInstitutional('doc@trust.nhs.uk')).toBe(true)
  })

  it('accepts .edu worldwide', () => {
    expect(isInstitutional('phd@harvard.edu')).toBe(true)
    expect(isInstitutional('x@nus.edu.sg')).toBe(true)
    expect(isInstitutional('y@usp.edu.br')).toBe(true)
  })

  it('accepts European institutional patterns', () => {
    expect(isInstitutional('z@uni-heidelberg.de')).toBe(true)
    expect(isInstitutional('w@ethz.ch') || isInstitutional('w@eth.ch')).toBe(true)
    expect(isInstitutional('v@inserm.fr')).toBe(true)
  })

  it('rejects consumer and corporate domains', () => {
    expect(isInstitutional('someone@gmail.com')).toBe(false)
    expect(isInstitutional('someone@outlook.com')).toBe(false)
    expect(isInstitutional('someone@acme-pharma.com')).toBe(false)
  })

  it('handles malformed input', () => {
    expect(isInstitutional('')).toBe(false)
    expect(isInstitutional(null)).toBe(false)
    expect(isInstitutional(undefined)).toBe(false)
    expect(isInstitutional('no-at-sign')).toBe(false)
  })

  it('has no duplicate domain entries', () => {
    expect(new Set(INSTANT_DOMAINS).size).toBe(INSTANT_DOMAINS.length)
  })
})
