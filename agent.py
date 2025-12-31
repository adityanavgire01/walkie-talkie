import os
import shutil
from openai import OpenAI
from deepgram import DeepgramClient
from dotenv import load_dotenv

# --- CONFIGURATION ---
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

if not OPENAI_API_KEY or not DEEPGRAM_API_KEY:
    raise ValueError("Missing API Keys. Please check your .env file.")

# Initialize Clients
default_openai_client = OpenAI(api_key=OPENAI_API_KEY)
deepgram = DeepgramClient(api_key=DEEPGRAM_API_KEY)

# Audio directory
AUDIO_DIR = "audio_files"
os.makedirs(AUDIO_DIR, exist_ok=True)


def validate_openai_key(api_key: str) -> dict:
    """Validate an OpenAI API key by making a simple API call."""
    try:
        test_client = OpenAI(api_key=api_key)
        # Make a minimal API call to validate the key
        test_client.models.list()
        return {"valid": True}
    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "api key" in error_msg.lower():
            return {"valid": False, "error": "Invalid API key"}
        return {"valid": False, "error": f"Validation failed: {error_msg}"}


class VoiceAssistant:
    def __init__(self, memory_size: int = 5):
        self.memory_size = memory_size
        self.conversation_history = []  # Stores message dicts for OpenAI
        self.conversations = []  # Stores full conversation data with audio paths
        self.use_context = False  # Whether to use conversation context
        self.is_custom = False  # Whether using custom context size
        self.custom_openai_client = None  # Custom OpenAI client for custom API key
    
    def set_memory_size(self, size: int, is_custom: bool = False, api_key: str = None):
        """Update memory size and optionally set custom API key."""
        self.memory_size = size
        self.is_custom = is_custom
        
        if api_key:
            self.custom_openai_client = OpenAI(api_key=api_key)
        elif not is_custom:
            self.custom_openai_client = None
        
        self._trim_conversations()
    
    def reset_custom_key(self):
        """Reset custom API key and return to default."""
        self.custom_openai_client = None
        self.is_custom = False
    
    def set_use_context(self, use_context: bool):
        """Set whether to use conversation context."""
        self.use_context = use_context
    
    def get_settings(self) -> dict:
        """Get current settings."""
        return {
            "memory_size": self.memory_size,
            "use_context": self.use_context,
            "is_custom": self.is_custom
        }
    
    def _trim_conversations(self):
        """Remove oldest conversations if over limit."""
        while len(self.conversations) > self.memory_size:
            removed = self.conversations.pop(0)
            # Delete associated audio files
            if os.path.exists(removed.get("input_audio", "")):
                os.remove(removed["input_audio"])
            if os.path.exists(removed.get("output_audio", "")):
                os.remove(removed["output_audio"])
        
        # Also trim the OpenAI message history
        max_messages = self.memory_size * 2
        if len(self.conversation_history) > max_messages:
            self.conversation_history = self.conversation_history[-max_messages:]
    
    def transcribe_audio(self, audio_data: bytes) -> str:
        """Transcribe audio bytes to text using Deepgram."""
        response = deepgram.listen.v1.media.transcribe_file(
            request=audio_data,
            model="nova-2",
            smart_format=True
        )
        transcript = response.results.channels[0].alternatives[0].transcript
        return transcript
    
    def get_ai_response(self, text: str) -> str:
        """Get AI response from OpenAI, with optional conversation context."""
        # Use custom client if set, otherwise default
        client = self.custom_openai_client if self.custom_openai_client else default_openai_client
        
        messages = [
            {"role": "system", "content": "You are a helpful, concise voice assistant. Keep answers short (under 2 sentences) for spoken audio."}
        ]
        
        # Only include conversation history if use_context is enabled
        if self.use_context:
            messages.extend(self.conversation_history)
        
        messages.append({"role": "user", "content": text})
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        reply = response.choices[0].message.content
        
        # Always add to history (for when context is enabled later)
        self.conversation_history.append({"role": "user", "content": text})
        self.conversation_history.append({"role": "assistant", "content": reply})
        
        # Trim history
        max_messages = self.memory_size * 2
        if len(self.conversation_history) > max_messages:
            self.conversation_history = self.conversation_history[-max_messages:]
        
        return reply
    
    def text_to_speech(self, text: str) -> bytes:
        """Convert text to speech using Deepgram, return audio bytes."""
        response = deepgram.speak.v1.audio.generate(
            text=text,
            model="aura-asteria-en"
        )
        audio_bytes = b"".join(chunk for chunk in response)
        return audio_bytes
    
    def process_conversation(self, audio_data: bytes) -> dict:
        """Process a full conversation turn: transcribe -> AI -> TTS."""
        conversation_id = len(self.conversations) + 1
        
        # Generate unique filenames with timestamp to avoid conflicts
        import time
        timestamp = int(time.time() * 1000)
        input_path = os.path.join(AUDIO_DIR, f"input_{timestamp}.wav")
        output_path = os.path.join(AUDIO_DIR, f"output_{timestamp}.mp3")
        
        # Save input audio
        with open(input_path, "wb") as f:
            f.write(audio_data)
        
        # Transcribe
        user_text = self.transcribe_audio(audio_data)
        
        if not user_text.strip():
            os.remove(input_path)
            return {"error": "No speech detected"}
        
        # Get AI response
        ai_response = self.get_ai_response(user_text)
        
        # Generate TTS
        tts_audio = self.text_to_speech(ai_response)
        
        # Save output audio
        with open(output_path, "wb") as f:
            f.write(tts_audio)
        
        # Store conversation data
        conversation_data = {
            "id": conversation_id,
            "user_text": user_text,
            "ai_text": ai_response,
            "input_audio": input_path,
            "output_audio": output_path
        }
        self.conversations.append(conversation_data)
        
        # Trim if over limit
        self._trim_conversations()
        
        # Renumber conversations after trim
        self._renumber_conversations()
        
        return conversation_data
    
    def _renumber_conversations(self):
        """Renumber conversation IDs after trimming."""
        for i, conv in enumerate(self.conversations):
            conv["id"] = i + 1
    
    def clear_all(self):
        """Clear all conversations and audio files."""
        self.conversation_history = []
        self.conversations = []
        # Clear audio directory
        if os.path.exists(AUDIO_DIR):
            shutil.rmtree(AUDIO_DIR)
        os.makedirs(AUDIO_DIR, exist_ok=True)
    
    def get_conversations(self) -> list:
        """Get all stored conversations."""
        return self.conversations
    
    def get_stats(self) -> dict:
        """Get current stats."""
        return {
            "count": len(self.conversations),
            "limit": self.memory_size
        }


# Global instance
assistant = VoiceAssistant(memory_size=5)
