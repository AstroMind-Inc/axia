# 04 — Spectral metrics (the "spectrum snapshot")

The Metadata Analyst feeds GPT-5 a **structured text snapshot** of 40+
quantitative metrics computed from the raw event list, plus two diagnostic
images. This is the most reliable analysis path — it always runs and never
depends on the GPU model.

The whole computation lives in
`service/src/spectrum/snapshot.py` (`make_spectrum_snapshot` + helpers) and
`service/src/spectrum/de_dt_map.py` (`create_de_dt_image`).

## What goes into the prompt

```
SPECTRUM SNAPSHOT for <source_name> (obsid=<obsid>)

[overview]
total_events    : 4,210
duration_s      : 28,793.4
mean_rate_cps   : 0.146

[energy quantiles, keV]
E25, E50, E75   : 0.62, 1.18, 2.34

[hardness ratios]
HS = (H-S)/(H+S) = 0.31     # H = 2-7 keV, S = 0.5-1.2 keV
HM = (H-M)/(H+M) = 0.18     # M = 1.2-2 keV
MS = (M-S)/(M+S) = 0.07

[emission lines, counts in window]
Fe Ka  (6.30-6.55 keV)  :  41  (FAP=2.1e-3)
Fe Kb  (6.95-7.10 keV)  :  12  (FAP=0.12)
...

[continuum, 32 log-binned bins]
[ ... ]

[variability]
K-S vs uniform           : p = 1.2e-7   (variable)
Fano factor              : 1.78
F_var (excess variance)  : 0.42
Gregory-Loredo index     : 6.4          (strong variability)
Bayesian-block segments  : 7

[periodicity]
Rayleigh Z1^2 over 1e-4 -- 0.25 Hz : peak at 1.6e-3 Hz, FAP = 5e-4
FFT integrated RMS (0.001 - 0.25 Hz) : 0.18

[time-energy coupling]
Hardness-intensity rho   : -0.37   (softer when brighter)
median_energy_first_half / second_half : 1.42 / 1.18 keV
```

(Two PNG images are attached separately: the binned light curve and the
energy-vs-time density map.)

## Sections in detail

### Energy quantiles

```
E25 = 25th percentile of photon energy [keV]
E50 = median (robust hardness indicator)
E75 = 75th percentile
```

These are scale-free, robust to outliers, and computable from <50 photons
where a full spectral fit would fail.

### Hardness ratios

Standard CSC band definitions:

```
S band : 0.5-1.2 keV
M band : 1.2-2.0 keV
H band : 2.0-7.0 keV

HS = (H - S) / (H + S)
HM = (H - M) / (H + M)
MS = (M - S) / (M + S)
```

Interpretation cheat sheet:

| HS range | Likely |
|---|---|
| HS < -0.5 | Soft (NS atmosphere, SNR shock, super-soft source) |
| -0.5 to 0 | Intermediate (most AGN coronae, stellar coronae) |
| 0 to 0.5 | Hard (jet, reflection) |
| > 0.5 | Very hard (heavily absorbed AGN, magnetar) |

### Emission line detection

For each of Fe Ka (6.40 keV), Fe Kb (7.06 keV), Fe XXV (6.70 keV), Fe XXVI
(6.97 keV), the snapshot reports the photon count inside a ±0.125 keV
window and the False Alarm Probability that this excess is consistent
with the local continuum, using a Poisson background model.

### Variability metrics

| Metric | Formula | Meaning |
|---|---|---|
| K-S vs uniform | Standard one-sample K-S over arrival times | p-value that the times are uniformly distributed |
| Fano factor | Var(counts) / mean(counts) in 100 s bins | 1.0 = Poisson, >1 = clustered, <1 = anti-correlated |
| F_var | sqrt((sigma^2_obs - sigma^2_Poisson) / mean^2) | Intrinsic variability amplitude (excess variance) |
| Gregory-Loredo index | Bayesian changepoint analysis | 0-2 constant, 3-5 moderate, 6-8 strong, 9-10 extreme |
| Bayesian-block segments | Number of optimal piecewise-constant segments | Counts independent "flaring/dipping" epochs |

### Periodicity

- **Rayleigh Z1^2 test**: scanned over `psd_freq_hz` (50 logarithmic
  frequencies, 1e-4 to 0.25 Hz). Reports peak frequency and a Bonferroni-
  corrected false-alarm probability.
- **FFT power spectrum**: integrated RMS in a given band, useful for
  red-noise-dominated AGN-like sources.

### Time-energy coupling

- **Hardness-intensity correlation**: Spearman rho between binned hardness
  and binned count rate. Positive means harder when brighter (e.g. some
  XRB low-hard state transitions), negative means softer when brighter
  (typical of AGN low-hard).
- **Median energy in first half vs second half**: a coarse-grained spectral
  evolution indicator.

## Diagnostic images

### Light curve (`create_light_curve_image`)

Binned count-rate vs time with Poisson error bars. Three cadences are
computed (`bin_size_s` = fixed 500 s, adaptive count, and Gregory-Loredo
optimal segments) and the appropriate one is rendered.

### Energy-time density map (`create_de_dt_image`)

2-D `(t, log E)` density map (no time/energy binning above what the
photon-time-energy plane already has). This makes spectral evolution and
transient flares visible without binning artefacts. Following the
Dillmann et al. (2024, MNRAS) prescription, both axes are normalised
(`tau = (t - t0) / (t_max - t0)`, `epsilon = log10 E`) so that sources of
very different durations and luminosities are visually comparable.

Both PNGs are attached as artifacts in the SSE stream and become part of
the chat conversation in the UI.

## How GPT-5 uses the snapshot

The Metadata Analyst's prompt template lives near
`service/src/llm/openai_infer.py` (`generate_openai_response`). It asks
GPT-5 to:

1. Identify the most likely emission mechanism (thermal, non-thermal,
   thermal+non-thermal composite).
2. Estimate spectral model parameters (Γ, kT, N_H) from the quantiles +
   hardness ratios, with uncertainty.
3. Classify the source type and category, ranking alternatives with
   probabilities when ambiguous.
4. Note signs of variability or periodicity and their physical implications.
5. State a confidence level on the final classification.

## Implementing new metrics

`make_spectrum_snapshot` returns a dict; `render_spectrum_text` formats it.
To add a new metric:

1. Compute it inside `make_spectrum_snapshot` (or in a helper imported there).
2. Add it to the returned dict.
3. Add a one-line rendering in `render_spectrum_text` so GPT-5 actually sees it.
4. If you want it to affect classification, mention it in the Metadata
   Analyst prompt template.

Nothing else changes — the Critic and Moderator agents pick up the new
field automatically because they read the whole snapshot text.
