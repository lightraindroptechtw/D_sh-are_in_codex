# 四個工具的本機功能測試

strict/lenient 共 22 次呼叫；第三模式另以最新核心重新生成4個插件，執行 11 次功能案例。
第三模式：11/11 斷言通過，11/11 個結構化功能結果可觀察。核心 SHA-256：bf586da3771e58af0e3e22f2b954ad6cdf9e83645e258cc30ee03d4f4ff487d3。

## 三種模式

| 模式 | 案例數 | 斷言通過 | 可觀察功能輸出 |
|---|---:|---:|---:|
| strict (lenientOutput=false) | 11 | 11 | 0 |
| lenient (lenientOutput=true) | 11 | 11 | 9 |
| lenient + allowUndeclaredOutput | 11 | 11 | 11 |

第三模式只放寬 output schema 的 `additionalProperties:false`，保留已宣告欄位的型別、必填與 enum 驗證，不放寬輸入、不刪實際結果。

## 第三模式實際輸出

| 案例 | 工具 | 預期 | 實際 | 斷言 |
|---|---|---|---|---|
| academic-citation | academic_writing | "APA citation text exactly formats the supplied author and journal fields." | {"action":"citation","text":"Author, S. (2024). Synthetic Batch Validation. Synthetic Journal, 1(1), 1-2."} | 通過 |
| academic-check-clean | academic_writing | "No local academic phrasing flags; punctuation is present." | {"action":"check","text":"No issues found — passage looks clean.","issues":[],"passed":true} | 通過 |
| academic-check-boundary | academic_writing | "Detect first-person wording, hedging, and missing sentence-final punctuation." | {"action":"check","text":"Issues found:\n- 2 first/second-person pronoun(s) found — most academic registers avoid them (check the target venue).\n- 2 hedging word(s) found — fine for cautious claims; avoid over-hedging.\n- The passage does not end with sentence-final punctuation.","issues":["2 first/second-person pronoun(s) found — most academic registers avoid them (check the target venue).","2 hedging word(s) found — fine for cautious claims; avoid over-hedging.","The passage does not end with sentence-final punctuation."],"passed":false} | 通過 |
| education-classstats | edu_kit | "Population mean/median 84, population standard deviation 9.8, pass rate 100%, four score bands." | {"action":"classstats","text":"# Class statistics\n\nn=3 | mean=84 | median=84 | stdev=9.8\nmax=96 | min=72 | pass line=60 | pass rate=100%\n\n| Score band | Count | % |\n|------------|-------|---|\n| 0-25 | 0 | 0 |\n| 25-50 | 0 | 0 |\n| 50-75 | 1 | 33.3 |\n| 75-100 | 2 | 66.7 |"} | 通過 |
| education-quiz-valid | edu_kit | "One well-formed question with two unique choices and in-range answer is valid." | {"action":"quiz","text":"Quiz valid: 1 item(s) OK.","issues":[],"valid":true,"count":1} | 通過 |
| education-quiz-invalid | edu_kit | "Duplicate options, out-of-range answer, and empty explanation are reported." | {"action":"quiz","text":"Quiz issues found:\n- item 1: duplicate options.\n- item 1: answer index 2 out of range [0, 1].\n- item 1: empty explanation.","issues":["item 1: duplicate options.","item 1: answer index 2 out of range [0, 1].","item 1: empty explanation."],"valid":false,"count":1} | 通過 |
| translation-segment-boundary | translate_kit | "Each sentence becomes a numbered segment under the 32-character maximum." | {"action":"segment","text":"[1] Synthetic first sentence.\n\n[2] Synthetic second sentence.","segments":[{"index":1,"text":"Synthetic first sentence."},{"index":2,"text":"Synthetic second sentence."}]} | 通過 |
| translation-qa-valid | translate_kit | "Identical source and target preserve number/unit and punctuation with ratio 1." | {"action":"check","text":"QA passed: numbers/units and brackets match, length ratio 1.00.","issues":[],"passed":true,"ratio":1} | 通過 |
| translation-qa-mismatch | translate_kit | "Report changed number/unit and an unbalanced opening parenthesis." | {"action":"check","text":"QA issues found:\n- Numbers/units in source missing from target: 12kg\n- Numbers/units in target not present in source: 10kg\n- Unbalanced '()' in target (1 vs 0).","issues":["Numbers/units in source missing from target: 12kg","Numbers/units in target not present in source: 10kg","Unbalanced '()' in target (1 vs 0)."],"passed":false,"ratio":0.9285714285714286} | 通過 |
| verify-json-valid | verify | {"action":"config","ok":true,"detail":"valid JSON","summary":{"format":"json","depth":1}} | {"action":"config","ok":true,"detail":"valid JSON","summary":{"format":"json","depth":1}} | 通過 |
| verify-json-invalid | verify | {"action":"config","ok":false,"detailContains":"invalid JSON:","summary":{"format":"json"}} | {"action":"config","ok":false,"detail":"invalid JSON: Unexpected token '}', ...\"e,\"count\":}\n\" is not valid JSON","summary":{"format":"json"}} | 通過 |

verify 正常 JSON 與錯誤 JSON 都已從工具結果讀回：正常案例 `ok=true`，錯誤案例 `ok=false` 並帶解析錯誤；`summary.format` 與成功時的 `summary.depth` 均保留。

完整 strict/lenient 與第三模式逐案例資料、schema、參數、執行時間及產物路徑見本 JSON 檔。
