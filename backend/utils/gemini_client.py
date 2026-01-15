from google import genai
from google.genai import types
import os
import time
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

# Configure the Gemini API
API_KEY = os.getenv("GEMINI_API_KEY")
client = None

if API_KEY:
    print("✅ SUCCESS: GEMINI_API_KEY detected. Configuring Gemini...")
    # Force stable v1 API version to avoid v1beta model availability issues
    client = genai.Client(api_key=API_KEY, http_options={'api_version': 'v1'})
else:
    print("❌ ERROR: GEMINI_API_KEY not found in environment variables!")

def retry_with_backoff(retries=3, initial_delay=2):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            delay = initial_delay
            last_exception = None
            for i in range(retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    error_str = str(e).upper()
                    # Check for rate limits or overloaded models
                    if any(err in error_str for err in ["429", "RESOURCE_EXHAUSTED", "503", "OVERLOADED"]) and i < retries - 1:
                        print(f"Gemini API issue ({error_str[:50]}). Retrying in {delay}s... (Attempt {i+1}/{retries})")
                        time.sleep(delay)
                        delay *= 2
                        continue
                    raise e
            raise last_exception
        return wrapper
    return decorator

@retry_with_backoff(retries=3, initial_delay=2)
def get_gemini_response(prompt: str, context: str = "", **kwargs) -> str:
    """Generates a response from Gemini using the provided context."""
    print(f"DEBUG: Generating text response for prompt: {prompt[:50]}...")
    if not client:
        raise Exception("Configuration Error: API Key not found")
    
    system_instruction = "You are a professional research assistant. ALWAYS use LaTeX for mathematical formulas ($ for inline, $ for block). If the user asks for numericals, represent them in their original mathematical structure using LaTeX."
    
    # Construct single prompt string to avoid turn-based validation errors in new SDK
    full_prompt = f"{system_instruction}\n\n"
    if context:
        full_prompt += f"Context:\n{context}\n\n"
    
    full_prompt += f"Question: {prompt}"
    
    try:
        response = client.models.generate_content(
            model='gemini-1.5-flash-latest',
            contents=full_prompt,
            config=types.GenerateContentConfig()
        )
        print(f"DEBUG: Successfully received response (length: {len(response.text)})")
        return response.text
    except Exception as e:
        print(f"DEBUG: API Call Error: {str(e)}")
        if "404" in str(e):
            print("ERROR: Model not found. Please check if gemini-2.0-flash is available.")
        raise e

@retry_with_backoff(retries=3, initial_delay=2)
def get_structured_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini that is expected to be structured (like JSON)."""
    print(f"DEBUG: Generating structured response for prompt: {prompt[:50]}...")
    if not client:
        raise Exception("Configuration Error: API Key not found")
    
    system_instruction = "You are a helpful academic assistant. ALWAYS use LaTeX for mathematical formulas ($ for inline, $ for block). If the user asks for numericals, represent them in their original mathematical structure using LaTeX."
    
    full_prompt = f"{system_instruction}\n\nContext:\n{context}\n\nInstruction: {prompt}" if context else f"{system_instruction}\n\nInstruction: {prompt}"
    
    try:
        response = client.models.generate_content(
            model='gemini-1.5-flash-latest',
            contents=full_prompt,
            config=types.GenerateContentConfig(
                response_mime_type='application/json'
            )
        )
        print(f"DEBUG: Successfully received structured response (length: {len(response.text)})")
        return response.text
    except Exception as e:
        print(f"DEBUG: Structured API Call Error: {str(e)}")
        json_only_prompt = full_prompt + "\n\nReturn ONLY valid JSON. No markdown. No commentary."
        response = client.models.generate_content(
            model='gemini-1.5-flash-latest',
            contents=json_only_prompt,
            config=types.GenerateContentConfig()
        )
        return response.text

@retry_with_backoff(retries=3, initial_delay=2)
def upload_to_gemini(file_bytes: bytes, filename: str):
    """Uploads a file to Gemini Files API for large payload processing."""
    if not client:
        raise Exception("Configuration Error: API Key not found")
    
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
        
    try:
        uploaded_file = client.files.upload_file(path=tmp_path, display_name=filename)
        return uploaded_file
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@retry_with_backoff(retries=5, initial_delay=5)
def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Generates embeddings for a list of texts using Gemini's embedding model."""
    if not client:
        raise Exception("Gemini API client not configured.")
    
    response = client.models.embed_content(
        model='text-embedding-004',
        contents=texts
    )
    return [item.values for item in response.embeddings]