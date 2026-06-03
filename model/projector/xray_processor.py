"""XrayProcessor — verbatim copy from model/server/base_functions.py.

Kept as a standalone file so the projector server has zero dependency on
the full LLM model code, transformers, or PEFT.
"""

import torch
import torch.nn as nn


class XrayProcessor(nn.Module):
    def __init__(
        self,
        hidden_size: int,
        max_events: int = 512,
        d_model: int = 256,
        n_layers: int = 6,
        n_heads: int = 8,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.hidden_size = hidden_size

        # 1) per-event tape
        self.event_proj = nn.Linear(5, d_model)
        self.pos_emb = nn.Parameter(torch.randn(1, max_events, d_model) * 0.02)

        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(enc_layer, n_layers)

        # 2) side branches
        def side_mlp(in_dim):
            return nn.Sequential(
                nn.Linear(in_dim, d_model // 2),
                nn.GELU(),
                nn.LayerNorm(d_model // 2),
                nn.Linear(d_model // 2, d_model // 2),
                nn.GELU(),
                nn.LayerNorm(d_model // 2),
            )

        self.spec_mlp = side_mlp(64)
        self.psd_mlp = side_mlp(50)
        self.meta_fc = nn.Sequential(
            nn.Linear(3, d_model // 2),
            nn.GELU(),
            nn.LayerNorm(d_model // 2),
        )

        # 3) fusion & projector
        concat_dim = d_model + 3 * (d_model // 2)
        self.fusion_ln = nn.LayerNorm(concat_dim)
        self.to_hidden = nn.Sequential(
            nn.Linear(concat_dim, hidden_size),
            nn.LayerNorm(hidden_size),
            nn.Dropout(dropout),
        )

    @torch.no_grad()
    def _make_src_key_padding_mask(self, event_mask):
        return ~event_mask

    def forward(self, per_event, event_mask, meta_token, spec_vec, psd_vec):
        B, T, _ = per_event.shape

        x = self.event_proj(per_event) + self.pos_emb[:, :T]
        key_pad = self._make_src_key_padding_mask(event_mask)
        tape_out = self.encoder(x, src_key_padding_mask=key_pad)
        pooled = tape_out.masked_fill(key_pad.unsqueeze(-1), 0).sum(1) / event_mask.sum(
            1, keepdim=True
        )

        spec_out = self.spec_mlp(spec_vec)
        psd_out = self.psd_mlp(psd_vec)
        meta_out = self.meta_fc(meta_token)

        fused = torch.cat([pooled, spec_out, psd_out, meta_out], dim=-1)
        fused = self.fusion_ln(fused)
        return self.to_hidden(fused)
