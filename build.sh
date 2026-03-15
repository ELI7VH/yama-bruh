#!/bin/bash
set -e
echo "Building yama-bruh WASM..."
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/yama_bruh.wasm www/
echo "Done. WASM binary: $(du -h www/yama_bruh.wasm | cut -f1)"
echo "Serve www/ directory to run."
