import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`)
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: 'Backend not available' },
      { status: 503 }
    )
  }
}

