from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

# Configure the Gemini API
API_KEY = os.getenv("GEMINI_API_KEY")
client = None

if API_KEY:
    client = genai.Client(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def get_gemini_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini using the provided context."""
    if not client:
        return "Error: Gemini API client not configured."
    
    full_prompt = f"Context:\n{context}\n\nQuestion: {prompt}" if context else prompt
    
    try:
        response = client.models.generate_content(
            model='gemini-flash-latest',
            contents=full_prompt
        )
        return response.text
    except Exception as e:
        return f"Error calling Gemini API: {str(e)}"

def get_structured_response(prompt: str, context: str = "") -> str:
    """Generates a response from Gemini that is expected to be structured (like JSON)."""
    if not client:
        return "[]"
    
    full_prompt = f"Context:\n{context}\n\nInstruction: {prompt}" if context else prompt
    
    try:
        response = client.models.generate_content(
            model='gemini-flash-latest',
            contents=full_prompt,
            config={
                'response_mime_type': 'application/json',
            }
        )
        return response.text
    except Exception as e:
        # If JSON mode fails or isn't supported by the model version, fall back to standard response
        return get_gemini_response(prompt, context)

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
