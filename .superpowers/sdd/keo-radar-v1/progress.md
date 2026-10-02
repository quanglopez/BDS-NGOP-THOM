# SDD ledger — plan: conversation summary (Kèo Radar V1 integration, no plan file in repo)

Executor: inline (executing-plans), human partner chose inline execution.

Pre-existing state carried in from prior session (already on branch or working tree):
- lib/radar/signals.ts (new, untracked) + tests/radar-signals.test.ts (new, untracked) — signal index/filter/attach. Focused test green.
- lib/radar/data.ts — scan integration; MIN_SAMPLE_SIZE import corrected to @/lib/price/types; attachSignals<Row> generic fix applied.
- app/api/radars/[id]/scan/route.ts — session client for ownership (getRadar(s,user.id,...)), service role only for scanRadar, failure update scoped by radar_id + user_id.

Task 1: verify source typecheck + focused Radar tests — complete (typecheck of lib/app/components clean; tests: 5 radar/price files EXIT=0)

Task 2: /code-review findings — complete
- lib/radar/data.ts: signalIndexFor luôn filter theo candidate IDs (bỏ early-return chết), dùng externalIds, comment schema/window.
- app/api/radars/[id]/route.ts: load existing trước, non-object body -> {}, merge {...existing, ...patch}, rồi validateRadarInput. Giữ 404/500 semantics, log [radar:update:load].
- app/api/cron/radar-scan/route.ts: failure update chỉ ghi last_scan_error="scan_failed", không bump updated_at, kiểm tra mark.error, catch markError, log [cron:radar-scan:mark-failed].

Task 3: final verification — complete (2026-10-02)
- npm test EXIT=0 (4 Radar suite chạy: radar-criteria, radar-match, radar-signals, radar-states).
- npm run build EXIT=0 — lint/typecheck/build sạch, 33 static pages, /radar + /radar/[id] có trong output.

Task 3b: final code-review trên diff chưa commit (user chọn scope = git diff HEAD, không review master...HEAD) — complete (2026-10-02)
- Standards sub-agent: không phát hiện vi phạm cứng với AGENTS.md.
- Finding "manual scan route nuốt lỗi update" — đã sửa: check mark.error, catch markError, log [radar:scan:mark-failed], không bump updated_at khi fail.
- Finding "threshold 70 hardcode trong UI" — đã sửa: components/radar/RadarForm.tsx import NGO_P_STRONG_THRESHOLD từ lib/radar/signals.ts (nguồn đã pin bằng tests/radar-signals.test.ts).
- Finding "cross-tenant score" — không phải bug/leak: score/deal_type/is_ngop là thuộc tính của tin, không đọc original_text. Đã document trong signalIndexFor để chặn hiểu sai thành lỗi bảo mật.
- Finding "SIGNAL_WINDOW không document" — đã sửa: ghi rõ user impact (mất tín hiệu, hiện scoring_available:false, tin vẫn hiện).
- Finding LIKE concat — không phải bug: areaV2/categoryCode đã ép integer trong criteria.ts.
- Finding per-request area lookup 5000 rows — defer V1 (xem Known limitations).
- Xác minh lại sau các fix trên: npm test EXIT=0, npm run build EXIT=0.

Task 4: commit — committed locally — 5d38032 (2026-10-02)
- Commit 5d38032025f28341ce8f50277a0950dca620326b "feat(radar): integrate signals, cron scan, and safety fixes" — 17 files, 730 insertions(+), 51 deletions(-).
- Final verification: npm test EXIT=0, npm run build EXIT=0, code review PASS (Tasks 3/3b), git diff HEAD --check EXIT=0, git diff HEAD trống (không còn tracked change).
- NOT PUSHED. Untracked còn lại (pre-existing, cố ý không commit): .agents/, .workbuddy-ai/, AGENTS.md, README_JEV.md, scripts/test-price-intelligence-e2e.ts, skills-lock.json.
- Production validation BLOCKED — cần explicit user approval; production radars rỗng, CRON_SECRET chưa set (route cố ý trả 500).

Known limitations (không sửa trong V1):
- checks không có listing_id; SQL scope theo candidate IDs không khả thi, cần migration ngoài phạm vi.
- SIGNAL_WINDOW=5000 phải quét global; candidate có Check ngoài cửa sổ có thể thành score=null (giữ theo thiết kế).
- Cron gọi global signal fetch lặp lại theo từng radar.
- isUuid deferred tại lib/report/slug.ts:101.
- Manual production validation cần user approval; production radars hiện rỗng, CRON_SECRET chưa set (route cố ý trả 500).
