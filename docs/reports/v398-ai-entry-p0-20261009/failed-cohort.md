# FAILED cohort: individual classification and native-token replay

Cohort: current instance start 2026-10-09 12:55:05 Asia/Shanghai through the saved `runs-final.json` snapshot. 75 runs: 31 COMPLETED, 43 FAILED, 1 RUNNING. Every FAILED is listed. Later runs are outside this bounded snapshot. No historical record was changed.

37 HTTP 400 `exceed_context_size_error`; 5 schema failures `min <= idealPrice <= max required`; 1 TP schema failure `target must be inside range`. The schema failures are contradictory model outputs, not context overflow; they remain rejected. No direction/price/TP repair was added by this patch. Raw output and exact numerical contradictions remain local in the replay evidence.

All 43 inputs were rebuilt from their archived packet and compared after decoding both candidate menus. Every original compact fact is equal; both sides and every candidate remain present. Native tokenizer budgets: 20,800–26,560, all READY under 28,000. Only redundant serialization changed.

| Run | Symbol | Actual failure | Original prompt tokens | New native tokens | Budget |
|---|---|---|---:|---:|---|
| airun_mv0hwoii_px6o5dxg | DOGEUSDC | CONTEXT_EXCEEDED | 38567 | 26332 | READY |
| airun_mv0hxayi_g81k331p | DOGEUSDC | CONTEXT_EXCEEDED | 38768 | 26373 | READY |
| airun_mv0hzoza_2ufb698o | WLDUSDT | CONTEXT_EXCEEDED | 38340 | 25945 | READY |
| airun_mv0i0171_j9x6edxt | DOGEUSDC | CONTEXT_EXCEEDED | 38724 | 26329 | READY |
| airun_mv0i0bzu_14rljy95 | WLDUSDT | CONTEXT_EXCEEDED | 38486 | 26091 | READY |
| airun_mv0i130f_w425njs2 | DOGEUSDC | CONTEXT_EXCEEDED | 38307 | 26560 | READY |
| airun_mv0i2gbs_dv7n00jj | DOGEUSDC | CONTEXT_EXCEEDED | 38220 | 26473 | READY |
| airun_mv0i8hqk_72d5gpdr | ADAUSDT | CONTEXT_EXCEEDED | 37993 | 25598 | READY |
| airun_mv0i8p8s_0buhoxsn | ADAUSDT | CONTEXT_EXCEEDED | 38058 | 25663 | READY |
| airun_mv0i8yrh_5zkpgzzx | DOGEUSDC | CONTEXT_EXCEEDED | 38092 | 26345 | READY |
| airun_mv0i9pmv_mzjjp21l | WLDUSDT | CONTEXT_EXCEEDED | 38526 | 26131 | READY |
| airun_mv0ieebk_h9nr44kb | TAOUSDT | CONTEXT_EXCEEDED | 37999 | 25868 | READY |
| airun_mv0iegri_eaaq4zlu | ADAUSDT | CONTEXT_EXCEEDED | 37996 | 25793 | READY |
| airun_mv0ig9rt_qmzsfd42 | DOGEUSDC | CONTEXT_EXCEEDED | 37740 | 25993 | READY |
| airun_mv0igc7j_47vof94u | ADAUSDT | CONTEXT_EXCEEDED | 37628 | 26073 | READY |
| airun_mv0ik03l_j4obugyr | FETUSDT | ENTRY_PRICE_RANGE_INVALID | 26970 | 20800 | READY |
| airun_mv0ip0qx_gk28tdol | TIAUSDT | CONTEXT_EXCEEDED | 38498 | 26103 | READY |
| airun_mv0iqr1x_euc5j8rc | DOGEUSDC | CONTEXT_EXCEEDED | 38412 | 26401 | READY |
| airun_mv0isgjb_t8th2afb | ONDOUSDT | ENTRY_PRICE_RANGE_INVALID | 27340 | 21170 | READY |
| airun_mv0iu5io_y0mpcmmg | JUPUSDT | CONTEXT_EXCEEDED | 38257 | 25862 | READY |
| airun_mv0iz8vs_iimbg8ht | DOGEUSDC | CONTEXT_EXCEEDED | 38832 | 26437 | READY |
| airun_mv0j2ts9_g6b4wypm | JUPUSDT | CONTEXT_EXCEEDED | 38423 | 26028 | READY |
| airun_mv0j4r2m_g1vie76v | ADAUSDT | CONTEXT_EXCEEDED | 38112 | 25717 | READY |
| airun_mv0j53dj_2324rkyf | ADAUSDT | CONTEXT_EXCEEDED | 38110 | 25715 | READY |
| airun_mv0j6y09_k4721w5m | DOGEUSDC | CONTEXT_EXCEEDED | 38764 | 26369 | READY |
| airun_mv0j71f1_ti98jbyo | JUPUSDT | CONTEXT_EXCEEDED | 38238 | 25843 | READY |
| airun_mv0je93q_64fsugw3 | DOGEUSDC | CONTEXT_EXCEEDED | 38343 | 25368 | READY |
| airun_mv0jedfi_in1dwdf0 | SUIUSDT | ENTRY_PRICE_RANGE_INVALID | 26846 | 20866 | READY |
| airun_mv0jhrkr_u9meapmm | ADAUSDT | CONTEXT_EXCEEDED | 38323 | 25928 | READY |
| airun_mv0jhvkr_ib4smnnr | JUPUSDT | CONTEXT_EXCEEDED | 38179 | 25784 | READY |
| airun_mv0jlfe1_8akcfmwh | USELESSUSDT | CONTEXT_EXCEEDED | 38447 | 26052 | READY |
| airun_mv0jlito_9yvxhy9m | FETUSDT | ENTRY_PRICE_RANGE_INVALID | 26812 | 20834 | READY |
| airun_mv0jn683_8tltu0q3 | TIAUSDT | CONTEXT_EXCEEDED | 38526 | 26131 | READY |
| airun_mv0jn8tr_s2xnns8m | DOGEUSDC | CONTEXT_EXCEEDED | 38799 | 26404 | READY |
| airun_mv0joye7_td63ucjl | BRUSDT | TP_TARGET_RANGE_INVALID | 27556 | 21386 | READY |
| airun_mv0jqoxo_nbhbqmo0 | WLDUSDT | CONTEXT_EXCEEDED | 38355 | 25960 | READY |
| airun_mv0jqsi7_kzsn44qi | JUPUSDT | CONTEXT_EXCEEDED | 38189 | 25794 | READY |
| airun_mv0jugpu_gopgi3zn | USELESSUSDT | CONTEXT_EXCEEDED | 38354 | 25123 | READY |
| airun_mv0jw98j_n3fnyyzo | DOGEUSDC | CONTEXT_EXCEEDED | 38529 | 26454 | READY |
| airun_mv0jy23i_uhu6w60n | ADAUSDT | CONTEXT_EXCEEDED | 38218 | 25823 | READY |
| airun_mv0jy4s3_cuvppxu1 | TIAUSDT | CONTEXT_EXCEEDED | 38474 | 26079 | READY |
| airun_mv0jy8j5_k6b32wwt | WLDUSDT | CONTEXT_EXCEEDED | 37953 | 25750 | READY |
| airun_mv0jyzls_uury6due | BRUSDT | ENTRY_PRICE_RANGE_INVALID | 27093 | 21083 | READY |
