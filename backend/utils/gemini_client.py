import os
import time
from functools import wraps
from google import genai
from dotenv import load_dotenv

load_dotenv()

# Configure the Gemini API
API_KEY = os.getenv("GEMINI_API_KEY")
client = None

if API_KEY:
    client = genai.Client(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def retry_with_backoff(retries=3, initial_delay=2):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            delay = initial_delay
            for i in range(retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    error_str = str(e).upper()
                    if ("429" in error_str or "RESOURCE_EXHAUSTED" in error_str) and i < retries - 1:
                        print(f"Rate limit hit (429). Retrying in {delay}s... (Attempt {i+1}/{retries})")
                        time.sleep(delay)
                        delay *= 2
                        continue
                    raise e
            return func(*args, **kwargs)
        return wrapper
    return decorator

@retry_with_backoff(retries=5, initial_delay=5)
def get_gemini_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini using the provided context."""
    if not client:
        return "Error: Gemini API client not configured."
    
    system_instruction = "You are a helpful academic assistant. ALWAYS use LaTeX for mathematical formulas ($ for inline, $ for block). If the user asks for numericals, represent them in their original mathematical structure using LaTeX."
    
    full_prompt = f"Context:\n{context}\n\nQuestion: {prompt}" if context else prompt
    
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=full_prompt,
            config={
                'system_instruction': system_instruction
            }
        )
        return response.text
    except Exception as e:
        return f"Error calling Gemini API: {str(e)}"

@retry_with_backoff(retries=5, initial_delay=5)
def get_structured_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini that is expected to be structured (like JSON)."""
    if not client:
        return "[]"
    
    full_prompt = f"Context:\n{context}\n\nInstruction: {prompt}" if context else prompt
    
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=full_prompt,
            config={
                'response_mime_type': 'application/json',
            }
        )
        return response.text
    except Exception as e:
        # If JSON mode fails or isn't supported by the model version, fall back to standard response
        return get_gemini_response(prompt, context)

@retry_with_backoff(retries=5, initial_delay=5)
def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Generates embeddings for a list of texts using Gemini's embedding model."""
    if not client:
        raise Exception("Gemini API client not configured.")
    
    try:
        response = client.models.embed_content(
            model='text-embedding-004',
            contents=texts
        )
        return [item.values for item in response.embeddings]
    except Exception as e:
        print(f"Error generating embeddings: {str(e)}")
        raise e
