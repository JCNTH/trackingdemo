#!/usr/bin/env python
"""
Run the Exercise Tracker backend server.

Usage:
    python run.py
    python run.py --port 8000
    python run.py --reload
"""

import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

import uvicorn
from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Run the Exercise Tracker API server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", 8000)), help="Port to bind to (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    
    args = parser.parse_args()
    
    print(f"Starting Exercise Tracker API on http://{args.host}:{args.port}")
    print(f"API docs available at http://localhost:{args.port}/docs")
    
    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )

