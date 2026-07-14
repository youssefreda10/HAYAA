import modal
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import List
import os

MAX_BATCH_SIZE = 50
MAX_TEXT_LENGTH = 2000

# Define FastAPI app
web_app = FastAPI(title="Hayā API")

# Only browser-extension origins may call this API. A page on the open web
# hitting it directly gets no CORS headers back, so the browser blocks the read.
# allow_credentials stays False: the API takes no cookies or auth, and
# credentialed requests cannot be paired with a wildcard origin anyway.
EXTENSION_ORIGIN_RE = r"^(chrome-extension|moz-extension|safari-web-extension)://[a-zA-Z0-9\-]+$"

web_app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=EXTENSION_ORIGIN_RE,
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

class RequestPayload(BaseModel):
    inputs: List[str]

    @field_validator("inputs")
    @classmethod
    def validate_inputs(cls, v):
        if len(v) == 0:
            raise ValueError("inputs must not be empty")
        if len(v) > MAX_BATCH_SIZE:
            raise ValueError(f"batch size {len(v)} exceeds maximum {MAX_BATCH_SIZE}")
        for i, text in enumerate(v):
            if not isinstance(text, str):
                raise ValueError(f"inputs[{i}] must be a string")
            if len(text) > MAX_TEXT_LENGTH:
                raise ValueError(f"inputs[{i}] exceeds {MAX_TEXT_LENGTH} characters")
        return v

# Define Modal environment image
image = (
    modal.Image.debian_slim()
    .pip_install("transformers", "torch", "huggingface_hub", "fastapi[standard]")
)

# Define Modal App
app = modal.App("haya-text-classifier", image=image)

# Define the Model class
@app.cls(image=image, cpu=1.0, secrets=[modal.Secret.from_name("huggingface-secret")])
class Classifier:
    @modal.enter()
    def load_model(self):
        from transformers import pipeline
        # Load model using the HuggingFace token
        # top_k=None ensures it returns all labels with their probabilities
        self.classifier = pipeline(
            "text-classification", 
            model="youssefreda9/HAYAA", 
            token=os.environ.get("HF_TOKEN"),
            top_k=None 
        )

    @modal.method()
    def classify(self, texts: List[str]):
        # The pipeline accepts a list of strings directly
        return self.classifier(texts)

# Define the endpoint route
@web_app.post("/")
def classify_text(payload: RequestPayload):
    classifier = Classifier()
    # Call the remote method synchronously
    results = classifier.classify.remote(payload.inputs)
    return results

# Expose the FastAPI app
@app.function()
@modal.asgi_app()
def fastapi_app():
    return web_app
