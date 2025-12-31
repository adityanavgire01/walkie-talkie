import os
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from agent import assistant, validate_openai_key, AUDIO_DIR

app = FastAPI(title="Voice Assistant API")

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")


class MemorySizeRequest(BaseModel):
    size: int
    is_custom: bool = False
    api_key: Optional[str] = None


class SettingsRequest(BaseModel):
    use_context: bool


class ValidateKeyRequest(BaseModel):
    api_key: str


@app.get("/")
async def root():
    """Serve the main HTML page."""
    return FileResponse("static/index.html")


@app.post("/api/process")
async def process_audio(audio: UploadFile = File(...)):
    """Process uploaded audio: transcribe -> AI -> TTS."""
    try:
        audio_data = await audio.read()
        result = assistant.process_conversation(audio_data)
        
        if "error" in result:
            return JSONResponse(content=result, status_code=400)
        
        # Convert file paths to URLs
        result["input_audio_url"] = f"/audio/{os.path.basename(result['input_audio'])}"
        result["output_audio_url"] = f"/audio/{os.path.basename(result['output_audio'])}"
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/conversations")
async def get_conversations():
    """Get all stored conversations."""
    conversations = assistant.get_conversations()
    # Add URLs to each conversation
    result = []
    for conv in conversations:
        conv_copy = conv.copy()
        conv_copy["input_audio_url"] = f"/audio/{os.path.basename(conv['input_audio'])}"
        conv_copy["output_audio_url"] = f"/audio/{os.path.basename(conv['output_audio'])}"
        result.append(conv_copy)
    return result


@app.get("/api/stats")
async def get_stats():
    """Get current stats."""
    return assistant.get_stats()


@app.get("/api/settings")
async def get_settings():
    """Get current settings."""
    return assistant.get_settings()


@app.post("/api/settings")
async def update_settings(request: SettingsRequest):
    """Update settings."""
    assistant.set_use_context(request.use_context)
    return {"status": "ok", "use_context": request.use_context}


@app.post("/api/memory-size")
async def set_memory_size(request: MemorySizeRequest):
    """Update the conversation memory size."""
    # Validate size
    if request.is_custom:
        if request.size < 1 or request.size > 100:
            raise HTTPException(status_code=400, detail="Custom size must be between 1 and 100")
    else:
        if request.size not in [5, 10, 20]:
            raise HTTPException(status_code=400, detail="Memory size must be 5, 10, or 20")
    
    assistant.set_memory_size(request.size, request.is_custom, request.api_key)
    return {"status": "ok", "memory_size": request.size, "is_custom": request.is_custom}


@app.post("/api/validate-key")
async def validate_key(request: ValidateKeyRequest):
    """Validate an OpenAI API key."""
    result = validate_openai_key(request.api_key)
    return result


@app.post("/api/reset-custom-key")
async def reset_custom_key():
    """Reset custom API key and return to default."""
    assistant.reset_custom_key()
    assistant.set_memory_size(5, False, None)
    return {"status": "ok", "message": "Custom API key removed. Your key was only stored temporarily and is now gone from the system."}


@app.post("/api/clear")
async def clear_conversations():
    """Clear all conversations and start fresh."""
    assistant.clear_all()
    return {"status": "ok", "message": "All conversations cleared"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
