from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import json
import uuid
import traceback
import os

from utils.pdf_processor import extract_text_from_pdf, chunk_text
from utils.gemini_client import get_gemini_response, get_structured_response
from utils.vector_store import vector_store

app = FastAPI(title="ScholarSync API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= UTIL =================

def clean_json_string(raw: str) -> str:
    """Extracts JSON from a string, handling markdown and extra text."""
    raw = raw.strip()
    try:
        # Find boundaries of the JSON object or list
        indices = [i for i in [raw.find("{"), raw.find("[")] if i != -1]
        if not indices:
            return raw # Fallback
        start = min(indices)
        end = max(raw.rfind("}"), raw.rfind("]"))
        if end <= start:
            return raw # Fallback
        return raw[start:end + 1]
    except Exception:
        return raw

# ================= MODELS =================

class QueryRequest(BaseModel):
    prompt: str

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

class ConceptItem(BaseModel):
    term: str
    definition: str
    importance: int

class ConceptsResponse(BaseModel):
    concepts: List[ConceptItem]
    links: List[dict] = []

# ================= ROUTES =================

@app.get("/")
async def root():
    return {"status": "online", "message": "ScholarSync Engine is Live"}

@app.api_route("/", methods=["HEAD"])
async def root_head():
    return Response(status_code=200)

@app.post("/upload")
async def upload_materials(
    response: Response,
    files: List[UploadFile] = File(...),
    x_session_id: Optional[str] = Header(None),
):
    session_id = x_session_id or "default_user"
    uploaded_count, errors = 0, []

    for file in files:
        try:
            if not file.filename.lower().endswith(".pdf"):
                errors.append(f"{file.filename}: Not a PDF")
                continue

            content = await file.read()
            text = extract_text_from_pdf(content)

            if not text.strip():
                errors.append(f"{file.filename}: Empty content")
                continue

            chunks = chunk_text(text)
            metadatas = [{"filename": file.filename} for _ in chunks]
            ids = [f"{uuid.uuid4().hex}_{i}" for i in range(len(chunks))]
            
            vector_store.add_documents(session_id, chunks, metadatas, ids)
            uploaded_count += 1

        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")

    if uploaded_count == 0 and errors:
        raise HTTPException(status_code=400, detail=errors[0])
    
    response.status_code = 201 if uploaded_count > 0 else 200
    return {"message": f"Uploaded {uploaded_count} files", "errors": errors if errors else None}

@app.get("/materials")
async def list_materials(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    return vector_store.get_all_materials(session_id)

@app.delete("/materials")
async def clear_library(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    vector_store.clear_all(session_id)
    return {"message": "Library cleared"}

@app.delete("/materials/{filename}")
async def delete_file(filename: str, x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    vector_store.delete_file(session_id, filename)
    return {"message": f"Deleted {filename}"}

@app.post("/concepts", response_model=ConceptsResponse)
async def get_concepts(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    results = vector_store.query(session_id, "Key technical concepts and definitions", n_results=15)
    docs = results.get("documents", [[]])[0]
    
    if not docs:
        return ConceptsResponse(concepts=[], links=[])

    instruction = "Extract key technical terms. Return JSON with 'concepts' list (term, definition, importance 1-10) and 'links' list (source, target)."
    raw = get_structured_response(instruction, "\n\n".join(docs))
    
    try:
        data = json.loads(clean_json_string(raw))
        return ConceptsResponse(
            concepts=data.get("concepts", []),
            links=data.get("links", [])
        )
    except:
        return ConceptsResponse(concepts=[], links=[])

@app.post("/query", response_model=QueryResponse)
async def query_materials(
    request: QueryRequest,
    x_session_id: Optional[str] = Header(None),
):
    session_id = x_session_id or "default_user"
    results = vector_store.query(session_id, request.prompt, n_results=5)

    docs = results.get("documents", [[]])[0]
    metas = results.get("metas", results.get("metadatas", [[]]))[0]
    
    if not docs:
        return QueryResponse(answer="No relevant content found.", sources=[])

    sources = []
    seen = set()
    for doc, meta in zip(docs, metas):
        fname = meta.get("filename", "Unknown")
        if fname not in seen:
            sources.append(SourceInfo(filename=fname, snippet=doc[:200] + "..."))
            seen.add(fname)

    answer = get_gemini_response(request.prompt, "\n\n".join(docs))
    return QueryResponse(answer=answer, sources=sources)

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(x_session_id: Optional[str] = Header(None)):
    session_id = x_session_id or "default_user"
    results = vector_store.query(session_id, "Provide a comprehensive summary and analysis of the main topics and key findings across all documents.", n_results=10)
    docs = results.get("documents", [[]])[0]

    if not docs:
        raise HTTPException(400, "No material to analyze. Please upload documents first.")

    raw = get_structured_response(
        "Analyze the provided context. Return a JSON object with three fields: 'analysis' (a detailed string), 'learning_path' (a list of 5 progressive steps to master the content), and 'connections' (a list of 3-5 links between different topics).",
        "\n\n".join(docs),
    )

    try:
        data = json.loads(clean_json_string(raw))
        return AnalysisResponse(**data)
    except Exception as e:
        print(f"Analysis Parse Error: {str(e)}")
        # Fallback to a structured error response instead of crashing
        return AnalysisResponse(
            analysis="Failed to generate structured analysis. Here is the raw response: " + raw[:500],
            learning_path=["Review uploaded documents"],
            connections=["Main content"]
        )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))