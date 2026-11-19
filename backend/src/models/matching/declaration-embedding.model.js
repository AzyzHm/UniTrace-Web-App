import mongoose from 'mongoose';

// Kept apart from Declaration: vectors are large, only matching reads them, and no declaration
// query can ever send 384 numbers to a client.
const declarationEmbeddingSchema = new mongoose.Schema(
  {
    declaration: { type: mongoose.Schema.Types.ObjectId, ref: 'Declaration', required: true, unique: true },

    textVector: { type: [Number], default: undefined },
    textHash: { type: String, default: null }, // recompute only when the embedded text changed

    locationVector: { type: [Number], default: undefined },
    locationHash: { type: String, default: null }, // recompute only when the location changed

    imageVector: { type: [Number], default: undefined },
    imageSource: { type: String, default: null }, // picture filename the vector comes from
  },
  { timestamps: true },
);

export const DeclarationEmbedding = mongoose.model('DeclarationEmbedding', declarationEmbeddingSchema);