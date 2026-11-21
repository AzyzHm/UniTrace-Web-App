#!/usr/bin/env bash
# One Node process per model so RAM and load time are not polluted by the others.
for m in e5-small minilm-ml e5-base labse minilm-en; do   # add bge-m3 if your server has 1 GB+
  echo "=== $m"
  node run.js $m
done
node table.js
