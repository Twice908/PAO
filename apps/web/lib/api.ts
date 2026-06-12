export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message =
      (body as { error?: { message?: string }; message?: string } | null)?.error?.message ??
      (body as { message?: string } | null)?.message ??
      `Request failed with status ${res.status}`
    throw new Error(message)
  }

  return res.json() as Promise<T>
}
