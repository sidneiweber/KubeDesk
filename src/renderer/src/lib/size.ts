/** Tamanho em bytes legível: "512 B", "1.5 KiB", "2 MiB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1).replace(/\.0$/, '')} ${units[i]}`
}
