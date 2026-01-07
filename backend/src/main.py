import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import videos, click_to_track
from db.supabase import init_supabase

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize resources on startup, cleanup on shutdown."""
    logger.info("Starting up Exercise Tracker API...")
    
    # Initialize Supabase client
    init_supabase()
    
    yield
    
    logger.info("Shutting down Exercise Tracker API...")


app = FastAPI(
    title="Exercise Tracker API",
    description="Video-based exercise tracking with YOLO and MediaPipe",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if os.getenv("NODE_ENV") != "production" else None,
    redoc_url="/redoc" if os.getenv("NODE_ENV") != "production" else None,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "Exercise Tracker API"}


app.include_router(videos.router, prefix="/api/videos", tags=["videos"])
app.include_router(click_to_track.router, prefix="/api", tags=["click-to-track"])


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

