# System audit archive — 2026-10-07

This directory stores the higher-level independent audit generated from main baseline `66f61d08391ed39713521365f421536e443e05b7`.

Files:
- `SYSTEM_AUDIT_20261007.md` — prioritized audit report.
- `AUDIT_QUESTIONS_255_20261007.md` — 255/255 question-by-question answers.
- `AUDIT_EVIDENCE_20261007.zip.b64.partNN` — lossless base64 parts of the original evidence ZIP.
- `AUDIT_EVIDENCE_20261007.sha256` — checksum of the original ZIP.

Original ZIP SHA256:
`956781234f105f383a0379537263e7dabd882ddd12924bb42c9f11e0fb3335ca`

Reconstruction (PowerShell, run from this directory after all parts are present):

```powershell
$base64 = (Get-ChildItem 'AUDIT_EVIDENCE_20261007.zip.b64.part*' | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Raw }) -join ''
[IO.File]::WriteAllBytes('AUDIT_EVIDENCE_20261007.zip',[Convert]::FromBase64String($base64))
(Get-FileHash 'AUDIT_EVIDENCE_20261007.zip' -Algorithm SHA256).Hash.ToLower()
```

The resulting hash must equal the checksum above.
