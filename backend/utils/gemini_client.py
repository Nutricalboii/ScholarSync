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
    client = genai.Client(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def retry_with_backoff(retries=5, initial_delay=5):
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

@retry_with_backoff(retries=5, initial_delay=5)
def get_gemini_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini using the provided context."""
    if not client:
        return "Error: Gemini API client not configured."
    
    system_instruction = "You are a helpful academic assistant. ALWAYS use LaTeX for mathematical formulas ($ for inline, $$ for block). If the user asks for numericals, represent them in their original mathematical structure using LaTeX."
    
    full_prompt = f"Context:\n{context}\n\nQuestion: {prompt}" if context else prompt
    
    response = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=full_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction
        )
    )
    return response.text

@retry_with_backoff(retries=5, initial_delay=5)
def get_structured_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini that is expected to be structured (like JSON)."""
    if not client:
        return "[]"
    
    system_instruction = "You are a helpful academic assistant. ALWAYS use LaTeX for mathematical formulas ($ for inline, $$ for block). If the user asks for numericals, represent them in their original mathematical structure using LaTeX."
    
    full_prompt = f"Context:\n{context}\n\nInstruction: {prompt}" if context else prompt
    
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                # Fix: remove mime type if it causes issues, or ensure it's correct
                response_mime_type='application/json'
            )
        )
        return response.text
    except Exception as e:
        # If JSON mode fails or isn't supported, fall back to standard response
        # which will also be retried by its own decorator
        print(f"Structured response failed, falling back: {str(e)}")
        return get_gemini_response(prompt, context)

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