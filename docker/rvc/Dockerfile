FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

# Install system + build dependencies, Python packages, then clean up build deps
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    build-essential \
    gcc \
    g++ \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir rvc-python==0.1.5 \
    && apt-get purge -y --auto-remove build-essential gcc g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server.py .

VOLUME ["/models"]

EXPOSE 5050

CMD ["python", "server.py"]
