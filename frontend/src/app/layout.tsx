import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Exercise Tracker - Movement Analysis',
  description: 'Video-based exercise tracking with YOLO object detection and MediaPipe pose estimation',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background" suppressHydrationWarning>
        <Providers>
          <main className="flex min-h-screen flex-col">
            {children}
          </main>
          <Toaster position="bottom-right" richColors />
        </Providers>
      </body>
    </html>
  )
}

