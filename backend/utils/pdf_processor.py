import pypdf
import io

def extract_text_from_pdf(file_content: bytes) -> str:
    """Extracts text from a PDF file provided as bytes."""
    pdf_reader = pypdf.PdfReader(io.BytesIO(file_content))
    text = ""
    for page in pdf_reader.pages:
        text += page.extract_text() or "" + "\n"
    
    if not text.strip():
        print(f"WARNING: No text could be extracted from the PDF.")
        
    return text

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
