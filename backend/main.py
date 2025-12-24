from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

from utils.pdf_processor import extract_text_from_pdf, chunk_text
from utils.gemini_client import get_gemini_response
from utils.vector_store import vector_store
import uuid

app = FastAPI(title="ScholarSync API")

# Enable CORS for frontend integration
# Using wildcard for maximum reliability during deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for extracted text (for MVP)
# In a production app, this would be a database or vector store
study_materials = []

class QueryRequest(BaseModel):
    prompt: str

class GenerateRequest(BaseModel):
    count: int = 5

class SourceInfo(BaseModel):
    filename: str
    snippet: str

class QueryResponse(BaseModel):
    answer: str
    sources: List[SourceInfo] = []

class AnalysisResponse(BaseModel):
    analysis: str
    learning_path: List[str] = []
    connections: List[str] = []

class Concept(BaseModel):
    term: str
    definition: str
    importance: int # 1-10

class ConceptLink(BaseModel):
    source: str
    target: str
    relationship: str

class Question(BaseModel):
    id: int
    question: str
    options: List[str]
    correct_answer: str
    explanation: str

class QuizResponse(BaseModel):
    questions: List[Question]

class ConceptsResponse(BaseModel):
    concepts: List[Concept]
    links: List[ConceptLink] = []

class Flashcard(BaseModel):
    front: str
    back: str

class FlashcardsResponse(BaseModel):
    flashcards: List[Flashcard]

@app.get("/")
async def root():
    return {"status": "online", "message": "ScholarSync API is running"}

@app.api_route("/", methods=["HEAD"])
async def root_head():
    return None

@app.post("/upload")
async def upload_material(file: UploadFile = File(...), x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    print(f"DEBUG: Uploading {file.filename} for session: {session_id}")
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        content = await file.read()
        text = extract_text_from_pdf(content)
        
        # Chunk text and add to vector store with session isolation
        chunks = chunk_text(text)
        metadatas = [{"filename": file.filename, "chunk_index": i} for i in range(len(chunks))]
        ids = [f"{file.filename}_{i}_{str(uuid.uuid4())[:8]}" for i in range(len(chunks))]
        
        vector_store.add_documents(session_id, chunks, metadatas, ids)
        
        return {
            "message": f"Successfully uploaded {file.filename}", 
            "chunks": len(chunks),
            "filename": file.filename
        }
    except Exception as e:
        print(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")

@app.post("/query", response_model=QueryResponse)
async def query_materials(request: QueryRequest, x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    print(f"DEBUG: Querying for session: {session_id} with prompt: {request.prompt[:50]}")
    try:
        # Perform semantic search with session isolation
        search_results = vector_store.query(session_id, request.prompt, n_results=5)
        
        sources = []
        context = ""
        
        # Combine retrieved chunks into context
        if search_results and search_results['documents'] and search_results['documents'][0]:
            context_chunks = search_results['documents'][0]
            metadatas = search_results['metadatas'][0]
            
            context = "\n\n---\n\n".join(context_chunks)
            
            # Build detailed source info
            seen_sources = set()
            for doc, meta in zip(context_chunks, metadatas):
                filename = meta['filename']
                if filename not in seen_sources:
                    # Take a short snippet from the chunk
                    snippet = doc[:200] + "..." if len(doc) > 200 else doc
                    sources.append(SourceInfo(filename=filename, snippet=snippet))
                    seen_sources.add(filename)
            
        answer = get_gemini_response(request.prompt, context)
        return QueryResponse(answer=answer, sources=sources)
    except Exception as e:
        print(f"Query error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error querying materials: {str(e)}")

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_connections(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    print(f"DEBUG: Starting analysis for session: {session_id}")
    
    materials = vector_store.get_all_materials(session_id)
    print(f"DEBUG: Found {len(materials)} materials for session {session_id}")
    
    if not materials:
        print(f"DEBUG: No materials found for session {session_id}. Vector store might be empty or session mismatch.")
        raise HTTPException(status_code=400, detail="No materials uploaded for analysis.")
    
    try:
        # Get a broad overview of all documents by querying for general themes
        # We'll use a summary of each document as context
        filenames = [m["filename"] for m in materials]
        
        analysis_prompt = f"""
        Analyze the following study materials: {', '.join(filenames)}.
        
        Provide a comprehensive analysis in two parts:
        1. A general synthesis of how these documents connect and supplement each other.
        2. A structured 'Learning Path' (list of 4-6 specific steps) to master this content.
        
        CRITICAL: If the materials contain math or numerical problems, use LaTeX formatting 
        ($...$ for inline, $...$ for blocks) in your analysis.
        
        Format your response as a JSON object:
        {{
            "analysis": "Your detailed synthesis text here...",
            "learning_path": ["Step 1...", "Step 2...", ...]
        }}
        """
        
        search_results = vector_store.query(session_id, "What are the key concepts and main topics in these documents?", n_results=10)
        context = "\n\n---\n\n".join(search_results['documents'][0]) if search_results['documents'] else ""
        
        from utils.gemini_client import get_structured_response
        raw_response = get_structured_response(analysis_prompt, context)
        
        try:
            import json
            clean_json = raw_response.strip()
            if clean_json.startswith("```json"): clean_json = clean_json[7:]
            if clean_json.endswith("```"): clean_json = clean_json[:-3]
            data = json.loads(clean_json)
            
            return AnalysisResponse(
                analysis=data.get("analysis", "No analysis generated."),
                learning_path=data.get("learning_path", []),
                connections=[]
            )
        except:
            return AnalysisResponse(analysis=raw_response, learning_path=[], connections=[])
    except Exception as e:
        print(f"Analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error performing analysis: {str(e)}")

@app.post("/concepts", response_model=ConceptsResponse)
async def extract_concepts(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    print(f"DEBUG: Extracting concepts for session: {session_id}")
    materials = vector_store.get_all_materials(session_id)
    if not materials:
        raise HTTPException(status_code=400, detail="No materials uploaded.")
    
    try:
        # Query for a wide variety of chunks to extract concepts
        search_results = vector_store.query(session_id, "What are the most important technical terms, concepts, and definitions in these materials?", n_results=20)
        
        context = ""
        if search_results and search_results['documents'] and search_results['documents'][0]:
            context = "\n\n---\n\n".join(search_results['documents'][0])
        
        prompt = """
        Extract the top 8-10 most important technical concepts or terms from the provided context.
        Also identify 5-8 relationships between these concepts.
        
        CRITICAL: For any mathematical formulas or numerical examples in the definitions, 
        ALWAYS use LaTeX formatting with $ for inline and $ for blocks.
        
        For each concept, provide:
        1. The term itself.
        2. A concise 1-sentence definition.
        3. An importance score from 1 to 10.
        
        For each relationship, provide:
        1. Source concept term.
        2. Target concept term.
        3. A short description of the relationship (e.g., "is a type of", "uses", "depends on").
        
        Format the output as a JSON object with two keys: "concepts" (list of objects) and "links" (list of objects).
        Example: {{
            "concepts": [{"term": "HTML", "definition": "...", "importance": 10}],
            "links": [{"source": "HTML", "target": "Web Browser", "relationship": "rendered by"}]
        }}
        Only return the JSON object, nothing else.
        """
        
        from utils.gemini_client import get_structured_response
        concepts_data = get_structured_response(prompt, context)
        
        import json
        try:
            clean_json = concepts_data.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            
            data = json.loads(clean_json)
            return ConceptsResponse(
                concepts=data.get("concepts", []),
                links=data.get("links", [])
            )
        except Exception as json_err:
            print(f"JSON Parse error: {str(json_err)} - Data: {concepts_data}")
            return ConceptsResponse(concepts=[], links=[])
            
    except Exception as e:
        print(f"Concepts extraction error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error extracting concepts: {str(e)}")

@app.post("/quiz", response_model=QuizResponse)
async def generate_quiz(request: GenerateRequest = GenerateRequest(count=3), x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    materials = vector_store.get_all_materials(session_id)
    if not materials:
        raise HTTPException(status_code=400, detail="No materials uploaded.")
    
    try:
        # Get core content for quiz generation
        search_results = vector_store.query(session_id, "What are the most important facts, dates, and technical details in these materials?", n_results=10)
        
        context = ""
        if search_results and search_results['documents'] and search_results['documents'][0]:
            context = "\n\n---\n\n".join(search_results['documents'][0])
        
        prompt = f"""
        Generate {request.count} high-quality multiple-choice questions based on the provided context.
        Each question must have:
        1. A clear question.
        2. Exactly 4 options.
        3. One correct answer (matching one of the options).
        4. A brief explanation of why the answer is correct.
        
        Format the output as a JSON list of objects with keys: "id", "question", "options", "correct_answer", "explanation".
        Example: [{{ "id": 1, "question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "A", "explanation": "..." }}]
        Only return the JSON list, nothing else.
        """
        
        from utils.gemini_client import get_structured_response
        quiz_data = get_structured_response(prompt, context)
        
        import json
        try:
            clean_json = quiz_data.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            
            questions_list = json.loads(clean_json)
            return QuizResponse(questions=questions_list)
        except Exception as json_err:
            print(f"Quiz JSON Parse error: {str(json_err)} - Data: {quiz_data}")
            return QuizResponse(questions=[])
            
    except Exception as e:
        print(f"Quiz generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating quiz: {str(e)}")

@app.post("/flashcards", response_model=FlashcardsResponse)
async def generate_flashcards(request: GenerateRequest = GenerateRequest(count=5), x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    materials = vector_store.get_all_materials(session_id)
    if not materials:
        raise HTTPException(status_code=400, detail="No materials uploaded.")
    
    try:
        search_results = vector_store.query(session_id, "What are the key definitions, formulas, and core concepts in these materials?", n_results=15)
        context = "\n\n---\n\n".join(search_results['documents'][0]) if search_results['documents'] else ""
        
        prompt = f"""
        Generate {request.count} high-quality flashcards based on the provided context.
        Each flashcard must have a 'front' (question/term) and a 'back' (answer/definition).
        Focus on core concepts that are essential for exams.
        
        Format the output as a JSON list of objects with keys: "front", "back".
        Example: [{{ "front": "What is HTML?", "back": "HyperText Markup Language..." }}]
        Only return the JSON list, nothing else.
        """
        
        from utils.gemini_client import get_structured_response
        flashcard_data = get_structured_response(prompt, context)
        
        import json
        try:
            clean_json = flashcard_data.strip()
            if clean_json.startswith("```json"): clean_json = clean_json[7:]
            if clean_json.endswith("```"): clean_json = clean_json[:-3]
            
            flashcards_list = json.loads(clean_json)
            return FlashcardsResponse(flashcards=flashcards_list)
        except Exception as json_err:
            print(f"Flashcard JSON Parse error: {str(json_err)} - Data: {flashcard_data}")
            return FlashcardsResponse(flashcards=[])
            
    except Exception as e:
        print(f"Flashcard generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating flashcards: {str(e)}")

@app.get("/materials")
async def list_materials(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    return vector_store.get_all_materials(session_id)

@app.delete("/materials/{filename}")
async def delete_material(filename: str, x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    # Remove from vector store
    vector_store.delete_file(session_id, filename)
    return {"message": f"Successfully deleted {filename}"}

@app.delete("/materials")
async def clear_materials(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    vector_store.clear_all(session_id)
    return {"message": "All materials cleared"}

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
