import pypdf
import io

def extract_text_from_pdf(file_content: bytes) -> str:
    """Extracts text from a PDF file provided as bytes with memory safety."""
    try:
        pdf_reader = pypdf.PdfReader(io.BytesIO(file_content))
        text = ""
        # LIMIT: Prevent extracting more than 100,000 characters per file to save RAM
        char_limit = 100000 
        
        for page in pdf_reader.pages:
            if len(text) > char_limit:
                print(f"DEBUG: Character limit reached for file. Truncating.")
                break
            try:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
            except Exception as e:
                print(f"DEBUG: Error extracting page: {str(e)}")
                continue
        
        if not text.strip():
            print(f"DEBUG WARNING: No text extracted from PDF. This might be a scanned image or encrypted file.")
        else:
            print(f"DEBUG: Extracted {len(text)} characters from PDF.")
            
        return text
    except Exception as e:
        print(f"DEBUG: Failed to read PDF structure: {str(e)}")
        return ""

def chunk_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> list[str]:
    """Splits text into smaller chunks for embedding."""
    if not text:
        return []
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - chunk_overlap
        
    return chunks
