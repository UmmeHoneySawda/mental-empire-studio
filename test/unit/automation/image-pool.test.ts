import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

describe('TemplateImagePool', () => {
  beforeEach(() => {
    ;(globalThis as any).window = (globalThis as any).window || {}
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  })

  afterEach(() => cleanup())

  it('renders count and duration control', async () => {
    const { TemplateImagePool } = await import('../../../src/features/automation/TemplateImagePool')
    const onChange = vi.fn()
    render(React.createElement(TemplateImagePool, { paths: ['/tmp/a.png', '/tmp/b.png'], durationSec: 5, onChange }))
    expect(screen.getByText(/Images · 2 items/i)).toBeTruthy()
    expect(screen.getByText('Duration')).toBeTruthy()
  })

  it('remove one fires onChange with filtered imagePaths', async () => {
    const { TemplateImagePool } = await import('../../../src/features/automation/TemplateImagePool')
    const onChange = vi.fn()
    render(React.createElement(TemplateImagePool, { paths: ['/tmp/a.png', '/tmp/b.png'], durationSec: 5, onChange }))
    const removeBtns = screen.getAllByLabelText(/Remove/)
    expect(removeBtns.length).toBe(2)
    fireEvent.click(removeBtns[0]!)
    expect(onChange).toHaveBeenCalledWith({ imagePaths: ['/tmp/b.png'] })
  })

  it('clear all fires onChange with empty array', async () => {
    const { TemplateImagePool } = await import('../../../src/features/automation/TemplateImagePool')
    const onChange = vi.fn()
    render(React.createElement(TemplateImagePool, { paths: ['/a.png'], durationSec: 5, onChange }))
    const clearBtn = screen.getByRole('button', { name: /Clear all/i })
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith({ imagePaths: [] })
  })

  it('duration slider fires onChange with imageDurationSec', async () => {
    const { TemplateImagePool } = await import('../../../src/features/automation/TemplateImagePool')
    const onChange = vi.fn()
    render(React.createElement(TemplateImagePool, { paths: [], durationSec: 5, onChange }))
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    expect(slider).toBeTruthy()
    // SliderRow keeps local state and commits via handleChange; fire both change and input
    fireEvent.change(slider, { target: { value: '7' } })
    fireEvent.input(slider, { target: { value: '7' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith({ imageDurationSec: 7 })
  })

  it('import via file input merges via mergeImagePaths', async () => {
    const { TemplateImagePool } = await import('../../../src/features/automation/TemplateImagePool')
    const onChange = vi.fn()
    ;(window as any).api = {
      pathForFile: (f: File) => `/tmp/${(f as any).name}`,
      assets: {
        import: async (paths: string[]) => paths.map((p) => ({ canonicalPath: p })),
      }
    }
    render(React.createElement(TemplateImagePool, { paths: ['/tmp/a.png'], durationSec: 5, onChange }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['dummy'], 'b.png', { type: 'image/png' })
    Object.defineProperty(file, 'path', { value: '/tmp/b.png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // Should merge existing + new
    const call = onChange.mock.calls.find((c) => (c[0] as any).imagePaths)
    expect(call).toBeDefined()
    expect((call![0] as any).imagePaths).toEqual(expect.arrayContaining(['/tmp/a.png', '/tmp/b.png']))
  })

  it('dedups canonical paths via mergeImagePaths', async () => {
    const { mergeImagePaths } = await import('../../../src/features/automation/useAutomationDraft')
    expect(mergeImagePaths(['/a.jpg', '/b.jpg'], ['/b.jpg', '/c.jpg'])).toEqual(['/a.jpg', '/b.jpg', '/c.jpg'])
    expect(mergeImagePaths([], ['/x.jpg'])).toEqual(['/x.jpg'])
  })
})
