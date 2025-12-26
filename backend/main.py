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
    raw = raw.strip()
    start = min(i for i in [raw.find("{"), raw.find("[")] if i != -1)
    end = max(raw.rfind("}"), raw.rfind("]"))
    if end <= start:
        raise ValueError("Invalid JSON")
    return raw[start:end + 1]

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

# ================= ROUTES =================

@app.get("/")
async def root():
    return {"status": "online"}

@app.api_route("/", methods=["HEAD"])
async def root_head():
    return Response(status_code=200)

@app.post("/upload")
async def upload_materials(
    files: List[UploadFile] = File(...),
    x_session_id: Optional[str] = Header(None),
):
    session_id = x_session_id or "default_user"
    uploaded, errors = 0, []

    for file in files:
        try:
            if not file.filename.lower().endswith(".pdf"):
                errors.append(f"{file.filename}: Not PDF")
                continue

            content = await file.read()
            text = extract_text_from_pdf(content)

            if not text.strip():
                errors.append(f"{file.filename}: Empty")
                continue

            chunks = chunk_text(text)
            vector_store.add_documents(
                session_id,
                chunks,
                [{"filename": file.filename}] * len(chunks),
                [uuid.uuid4().hex for _ in chunks],
            )
            uploaded += 1

        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")

    return {"uploaded": uploaded, "errors": errors or None}

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
    results = vector_store.query(session_id, "Main topics", n_results=10)
    docs = results.get("documents", [[]])[0]

    if not docs:
        raise HTTPException(400, "No material to analyze")

    raw = get_structured_response(
        "Return JSON with analysis, learning_path, connections",
        "\n\n".join(docs),
    )

    return AnalysisResponse(**json.loads(clean_json_string(raw)))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
