// ffmpeg always appends the same boilerplate trailer on failure (stream stats,
// "Nothing was written...", "Conversion failed!"), which drowns out the actual
// error line when stderr is naively tailed. Filter that trailer out first so the
// truncated message we show/log/report to Sentry is the actionable part.
const BOILERPLATE = [
  /^frame=/,
  /^size=/,
  /Nothing was written into output file/,
  /^Conversion failed!$/,
  /Qavg:/,
  /Lsize=/
]

export function ffmpegErrorTail(stderr: string, maxLen = 400): string {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() && !BOILERPLATE.some((re) => re.test(line)))
  const filtered = lines.join('\n').trim()
  return (filtered || stderr.trim()).slice(-maxLen)
}
