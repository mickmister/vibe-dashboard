FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      libclang-dev \
      libssl-dev \
      pkg-config \
      python3 \
      wget \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.93.0
ENV PATH="/root/.cargo/bin:${PATH}"
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true

RUN npm install -g opencode-ai@1.2.27

WORKDIR /app/Vktest
COPY Vktest/ /app/Vktest/

RUN cargo build --locked --release --bin server

EXPOSE 4020 4021

CMD ["/app/Vktest/target/release/server"]
