import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const { userId } = auth()
  if (userId) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white">
      <h1 className="text-5xl font-bold tracking-tight text-gray-900">PAO</h1>
      <p className="mt-4 text-lg text-gray-600">Observability for AI agents</p>
      <div className="mt-8 flex gap-4">
        <a
          href="/sign-in"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in
        </a>
        <a
          href="/sign-up"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          Sign up
        </a>
      </div>
    </main>
  )
}
