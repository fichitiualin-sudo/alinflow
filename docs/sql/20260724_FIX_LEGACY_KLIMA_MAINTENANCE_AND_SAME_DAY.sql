-- AlinFlow legacy Klima Excel fix: maintenance backfill and same-day installation merge.
-- Safe to rerun: uses legacy_source_key and link unique indexes.
-- Does not delete customers, appointments, work reports or declarations.

begin;

do $$
begin
  if to_regclass('public.appointments') is null then
    raise exception 'Required table public.appointments does not exist';
  end if;

  if to_regclass('public.quotes') is null then
    raise exception 'Required table public.quotes does not exist';
  end if;

  if to_regclass('public.quote_items') is null then
    raise exception 'Required table public.quote_items does not exist';
  end if;

  if to_regclass('public.maintenance_appointment_items') is null then
    raise exception 'Required table public.maintenance_appointment_items does not exist';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'workspace_id'
  ) then
    raise exception 'appointments.workspace_id is missing. Run workspace isolation before this fix.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quote_items' and column_name = 'workspace_id'
  ) then
    raise exception 'quote_items.workspace_id is missing. Run workspace isolation before this fix.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'maintenance_appointment_items' and column_name = 'workspace_id'
  ) then
    raise exception 'maintenance_appointment_items.workspace_id is missing. Run workspace isolation before this fix.';
  end if;
end $$;

create temp table _legacy_same_day_fixes on commit drop as
select *
from jsonb_to_recordset($legacy_same_day$[{"customer_name":"Pintér Péter","install_date":"2023-07-23","canonical_legacy_source_key":"legacy-klima-xlsx:installation:c2969f4302eb356d8cb66f4c","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:c266afaff05271e9f94aaf3e"],"source_rows":[2,3],"items":[{"name":"GREE COMFOT X 3,5 kW","quantity":2}]},{"customer_name":"Csrényiné Winke Bernadett","install_date":"2024-12-02","canonical_legacy_source_key":"legacy-klima-xlsx:installation:df1c0fbdff85bea835096611","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:3c64118e85b5ced19f799fa1"],"source_rows":[159,160],"items":[{"name":"Polár Optimum 3,5 kW","quantity":2}]},{"customer_name":"Borbély Zoltán","install_date":"2025-03-19","canonical_legacy_source_key":"legacy-klima-xlsx:installation:d29454fa379295524d4c8960","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:4a57a6772af820560697e67c"],"source_rows":[208,209],"items":[{"name":"GREE COMFOT PRO 3,5 kW","quantity":2}]},{"customer_name":"B. Nagy Norbert","install_date":"2025-05-26","canonical_legacy_source_key":"legacy-klima-xlsx:installation:aff26432e1da799e4439e0a8","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:f3b81d9f44026622cc96eb5c"],"source_rows":[291,292,293],"items":[{"name":"Auratsu Osaka 3,5 kW","quantity":3}]},{"customer_name":"Novák Roland","install_date":"2025-06-19","canonical_legacy_source_key":"legacy-klima-xlsx:installation:c4f0634b8855dccb8b5c8f85","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:a26876648eff32a3e2925100"],"source_rows":[331,332],"items":[{"name":"GREE COMFOT PRO 3,5 kW","quantity":2}]},{"customer_name":"Gajdos Norbert","install_date":"2025-07-24","canonical_legacy_source_key":"legacy-klima-xlsx:installation:915c1656ce8ca1c651c25558","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:cf6e63ca1f5117b556dd7047"],"source_rows":[352,353],"items":[{"name":"GREE COMFOT PRO 3,5 kW","quantity":2}]},{"customer_name":"Kustra Tibor","install_date":"2025-11-04","canonical_legacy_source_key":"legacy-klima-xlsx:installation:29f6955aa8a00e4e9076f1e5","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:174c12917dcff31f7d05e286"],"source_rows":[440,441],"items":[{"name":"GREE COMFOT PRO 3,5 kW","quantity":2}]},{"customer_name":"Gál József","install_date":"2025-11-05","canonical_legacy_source_key":"legacy-klima-xlsx:installation:52b6f1f86d6e18de2acf473a","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:f5983559a31edfaf9c72c038"],"source_rows":[442,443],"items":[{"name":"GREE COMFOT PRO 3,5 kW","quantity":2}]},{"customer_name":"Vandler Horváth Maria","install_date":"2025-11-12","canonical_legacy_source_key":"legacy-klima-xlsx:installation:8a6dcdd6904d6f0f873df510","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:4e26dd64253b207173f328f4"],"source_rows":[452,453],"items":[{"name":"FISHER COMFORT PLUS 3,5 kW","quantity":2}]},{"customer_name":"Szentpéteri Mária","install_date":"2025-12-12","canonical_legacy_source_key":"legacy-klima-xlsx:installation:08833f4ce9c6465d09e1415b","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:fc1a48c82c833d026702029f"],"source_rows":[486,487],"items":[{"name":"SYEN MUSE NEXT 3,5 kW","quantity":2}]},{"customer_name":"Szathmári Ferenc Flórián","install_date":"2026-02-26","canonical_legacy_source_key":"legacy-klima-xlsx:installation:b4092102972d88a76f72065e","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:1c1e763a8c9f3409e5f4f031"],"source_rows":[516,517],"items":[{"name":"Gree Comfort Pro 5,3 kW","quantity":1},{"name":"GREE COMFOT PRO 2,7 kW","quantity":1}]},{"customer_name":"Medveczky Mihályné","install_date":"2026-03-16","canonical_legacy_source_key":"legacy-klima-xlsx:installation:b4d0efddfc0583aefbfefeca","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:659c6c3e04a92d2c2c681f7d"],"source_rows":[530,531],"items":[{"name":"MDV One 3,5 kW","quantity":2}]},{"customer_name":"Horváth István","install_date":"2026-05-04","canonical_legacy_source_key":"legacy-klima-xlsx:installation:3c8a7baa348d0a8ae598b7b3","duplicate_legacy_source_keys":["legacy-klima-xlsx:installation:6eae1718d20135c9033539cb"],"source_rows":[560,561],"items":[{"name":"SYEN MUSE NEXT 3,5 kW","quantity":2}]}]$legacy_same_day$::jsonb) as f(
  customer_name text,
  install_date date,
  canonical_legacy_source_key text,
  duplicate_legacy_source_keys jsonb,
  source_rows jsonb,
  items jsonb
);

create temp table _legacy_maintenance_events on commit drop as
select *
from jsonb_to_recordset($legacy_maintenance$[{"legacy_source_key":"legacy-klima-xlsx:maintenance:00541b4d8309f1afcb4582e5","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3e30549391451e41d83a5023"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0257c64818c5e22c217e5ad6","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b01647240384437bcb02080e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0384dec23ccb1458c389c26a","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a080c7786bd314728c9cdd11"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:058b24a2239b90174c2cd6f6","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:2f0decc5a6679db480d48155"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0717ed550ade00e0b833aaaa","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d5ab3177aadda88618991df4"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0738da2c23da037439c3aba5","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:26331fcc7896fc89e6964719"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:08152cc1eaa54b5493b8a58a","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:08a54391b6bb0ce37fea871b"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:082aaa05051e895eeda2c248","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f71a392eb015a863e09a7855"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0a4ae57f844620cb5f9907ba","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c4f0634b8855dccb8b5c8f85"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0ac727afa0a8d6242d2caa4b","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:74988bde742ff011b3311ea3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0ce9dd2b767bde90b94993db","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f1eae4eb177168f3016f2d95"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0e620484dfb94f336387696a","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:6d4fa9846b25984f556daa11"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:0f8f49cc229eb7341311fb17","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:6b90c4053e970d369b4e6b7f"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:1005d150245ce5094cada27d","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c2969f4302eb356d8cb66f4c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:10db5d5275f2bfcb7ace454e","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1c663add4841155e667b7d9c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:126d69606bbef34150ac1b3b","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:55c48d21eb7c8dc9f70ce6d7"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:12992ed5e4e48ea56a7cd06f","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f9f10510f4f1d182eeeef6ac"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:14062baf26bd7db040911fd6","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c2969f4302eb356d8cb66f4c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:1634c3d2293d5820cd1a1895","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b01647240384437bcb02080e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:16f7a37418fd195a0d205456","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a9c3a0509c1316ea2446625d"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:1723b07cfcb8ec2368d05e84","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:581f15fd035e435bc038ba79"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:1877a26f99451f376c8f415c","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:759104f1562b6c400a8dfff5"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:20faff97c8fcd0216c5cc899","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:df1c0fbdff85bea835096611"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:2271b309503bc6e36d72f026","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3ccd63922d13102da3fd1cd2"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:23fb997f9de687fb0f33baf1","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:50fcfba8d4f2812b191bd1a0"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:255dc014cf26454ffdbb392b","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:305a95533ea14b6856be0195"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:280922273844a0e5a4d71d7f","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b21db3bf478be985e5d11d97"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:28578fc6ccee5acd89afcd51","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:84c3f0fe1b86dbabb08f8f03"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:2b72118d7185dc49f2e7c006","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1fec77dcb21cfe1976236015"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:2cd44d289300439c3dc72fd9","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:273257d3fb831bd6a9bb7651","legacy-klima-xlsx:installation:3eeee8d9a4de7bf735d2f747"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:2cf8e4a56cea0780081b8094","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3d525326028050b6d4b9e727"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:2e8e9f234fd279764ebc37c0","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:13bc95d7dc82b090be892485"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:3395fc9eb57382ae5ba11d53","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:99287a5906e74fe7f695c745"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:36078b180d3650231d969712","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3ccd63922d13102da3fd1cd2"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:371d1e89467eb9746d2bdcb9","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f9f10510f4f1d182eeeef6ac"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:3cd01700ebefdaea26e77626","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:766d413e05d28afcaa85e9c0"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:3dedcba2c2b94b822cc6b2f1","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d5ab3177aadda88618991df4"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:3e6ca032685d7e4ee78cccfa","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:21d5eb675776a37f28b97550"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:42c83823134d9234a03de0a0","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a919570d04b6259b0bd5f411"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:438730039dfd71ff36f1811e","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:08a54391b6bb0ce37fea871b"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:45e426426bde78460aee4361","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4d6db774ccfc7f8950468ff6"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:471f74b06527ba30119ed460","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d8c88bc1e0dfebbde4fa4357","legacy-klima-xlsx:installation:e9c3262cda381094aa5dfe36"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:4e7f9821684a71d1acd82e96","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:cbd57d8402d1d27087bc4b73"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:4f28362c2fb3ba5c5bd99baf","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:370088d9e7a482958565694e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:4faf5c0725884b3819bd7e2f","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d8c88bc1e0dfebbde4fa4357","legacy-klima-xlsx:installation:e9c3262cda381094aa5dfe36"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:509a2e605d66693634463ffc","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a919570d04b6259b0bd5f411"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:513841184d0798f0297632cc","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a81f9343d91d12588d9595b3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:551dc4cb354fab94b1e8f976","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1bf74d97db05d5d90bec0723"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5569cd427a4c0906410ab50e","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:ac2a618d9d51b1beace7b934"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5c7c4c161f555a18cbea91aa","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:ddb83462b5ef4e22f5918f44"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5c86ecebb6155d2464c638f7","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:74220bf78d02dc8f98591c39"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5d4bc71e0b29fb8d07b60b5b","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d2a304cac58e71e08d9010bb","legacy-klima-xlsx:installation:ddcb25b1f9ce3c5303c65ada"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5e75492a02bf89c50afde5dc","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1a1255fc6ce433a566f8da00","legacy-klima-xlsx:installation:6250858c5eca0e75a9bfed2c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5f80271b26e969c8f8f954cb","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:77da0a52d4c23b61fbcae5d6"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5f80c4c2e6b5a23953fbbf31","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:cd327d70db775c03e7c9ab42","legacy-klima-xlsx:installation:f65ec3cfb6fdb822e244374b"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5f8ec1fa0fca06307a9f3c7f","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:2831908823f52e9945cabfc6"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5fa0cc7f3b221aa16c77188c","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a81f9343d91d12588d9595b3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:5fa96ef08907b2863ef747fb","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1d856f55e1a93ac6de620281"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:625bf845a48a766565f1c0fa","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:bded98468ab632f3634d6d23"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:6987f68ae51675b32d90a3ec","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:e8f7db7a6bd92ac4ecb23d45"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:69f034380d61b76790ed2750","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1dd767edaae64a2ec707ff77"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:6a9aa6b81a3c4601f89f6ba7","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b233a56458a62b7c2e2efa32"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:6bf9e0951cee5d95e8b69b6c","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b82080228a0ee63c7ea5eace"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:6fc7d65fa0268ee529362ac8","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:124eed1b80abac3841f5091e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:719f6371655f0d98a135e27f","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:ba6ebb7f802c775730cb40cb"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:73c147a5a9f4c65866b7ed94","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:55a2ebb054095d2b4f7ef1bf"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:75d6b82b72c61599f7e71999","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f3e1271754680752abb72c29"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:7a34bffaacdf0872ca2a0a61","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d1d393b2f123d28c5972d524","legacy-klima-xlsx:installation:e944449535abf45c98c373ef"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:7c47fe095389815e8c15f966","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c953a104443f9cc91a0dee3d"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:7c4c96b3575ecba06d59b984","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:873e90680d86c9140207b882"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:7f37585acbf7a3c271e50815","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:5419ebe2e27caf11a386c764","legacy-klima-xlsx:installation:91b6f3529b69adef7ce2f686"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:7f767b23edda8a70623d3c3e","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a81f9343d91d12588d9595b3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:84d15ade49d7378fa8458862","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:02df119e83eeb096910628af"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:85afa422ef3e986a578a97b3","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3ce5b1b2f66b1e7fa2192f80"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:8673afe10fdba0ee359c70a7","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a9c3a0509c1316ea2446625d"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:8987bc4d2e364ddd12cbd08d","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:36e9dc9657ffa127bd3ee3ad"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:89aaed37094c9897510f6f50","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b233a56458a62b7c2e2efa32"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:8c938d3ad737a347a5622c37","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:ad7724429e5144d1f98be679"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:8f2d4ff749baba5a3d38025c","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d5560a7957973e6cf3388a17"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:93a3f13a3ab857ace71598e2","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:2686ad29d96a313770b235f2"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:93f6c6859b31dac6e671540a","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:a9e86115661a4e93ae0ff389"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:97bcd6c0ecf6857aa6c89510","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b4092102972d88a76f72065e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:982bfb3a9324f4dddcac5a59","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:2f648aeb581e541e5d9bface"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:9915a81e3d4aaf8b1ded2942","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:994bdefe81220b07259ac7e3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:9a26ec569dac351c23ca920a","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1a1255fc6ce433a566f8da00"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:9c2ed3a1c6f9b49baebd646c","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b21db3bf478be985e5d11d97"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:9d4f8dd522ad399f6eb4c74d","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:df1c0fbdff85bea835096611"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:a5d9c10dac423d76def36ef5","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d15a58eabe4a38fb1ecb6c4c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:a741a22f504e3742bbfe6bac","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:7554012ed5632e7cbfba7d82"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:a9fe83df7b1624b56dd86a18","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:54280150d997ac7447113727"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:aa88b9e0c0060d62b1657e1a","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:311320bf98624a6fb99ffe5c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:abe72ef71e8016cb4629b13b","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:617c1b58c2da8d09c0c24398"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:ac08b3f30b7f58c2d8625b89","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:513d9640a95fd6d13693d1ef"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:af84539a55c85e768aad23ee","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:3eeee8d9a4de7bf735d2f747"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:b10c1173fd41c163595f286f","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f7d2c2b88edfbe99a3446158"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:b1a2678752ed0d84081350e0","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f65ec3cfb6fdb822e244374b"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:b63ee577e770bc43529b5806","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1c663add4841155e667b7d9c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:b8f2993edd5699a6fc433154","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:13bc95d7dc82b090be892485"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:b982a8d672ec4c6212973608","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:f6439f6c8712ba84d38d4a6a"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:c3693bad42cf2a3dbf64c250","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:dfb140dbedc382c0ce5304ef"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:c4146599659dfd82a6956b4d","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:84c3f0fe1b86dbabb08f8f03"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:c5c5a9461d1136a369f2fd92","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c607df97b6b9df1f253db81c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:c5e3a9f6a5ec38bf685f178e","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4a2c2d87a0349c58810bdfcd","legacy-klima-xlsx:installation:9491c3295bbcf53149f43c10"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:cc3cfb6f3044adde870b0088","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:7078aa4862030fc3474c6a46"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:cca53f23d86c336ac4a69f4a","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:1a1255fc6ce433a566f8da00","legacy-klima-xlsx:installation:6250858c5eca0e75a9bfed2c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:d35da9b1378e266ec6c3b6ff","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:873e90680d86c9140207b882"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:d534942f912086383a9c6d64","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:9e74e61918c99d4ebf957d0e"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:dc2fcd11b97836b048d7eff1","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b612d40b42aff190254477f3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:dff696cc14807729256227a6","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:7ad4fe2a8c381e49d1d80c81","legacy-klima-xlsx:installation:d9840142fc3c596a943349c0"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:e2337d058f945553023bd09a","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:54280150d997ac7447113727"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:e650605438558539348429f8","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4a2c2d87a0349c58810bdfcd","legacy-klima-xlsx:installation:9491c3295bbcf53149f43c10"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:ec3fd6563f8fab2466c91dc5","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:058c9e5c050534d0c4719354"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:ed7b8f56c36ce41fffbf8ee1","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4b8b89520ae5cec8d41eab90"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:edb1467f809e7b99a27f63c7","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:c607df97b6b9df1f253db81c"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f0743aa6e3099f07a160f1d7","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:5c94ea8242f6eb56cd5cb463"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f1210ebb171cc369331f0b69","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4deccb6f87901bcc9c6150ad"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f12c25ae21de7e42a41c3b08","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:74988bde742ff011b3311ea3"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f3a5fb30d4be0bedb578b319","period_label":"2025/1","scheduled_date":"2025-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:b82080228a0ee63c7ea5eace"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f433693343cc4e60bd5652cf","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:11e8a988d74e7a24e15f748b"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f47bd0789867641e6b7259b1","period_label":"2026/1","scheduled_date":"2026-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:dd774ab3d0ba90b90bf82911"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f58baab81dc0b413022711c5","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:16cb61a0792e60e2c1eba9f1"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f6cb08c48aa98e652c1e0b18","period_label":"2024/2","scheduled_date":"2024-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:4d6db774ccfc7f8950468ff6"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f7e824b1fc6cdb07ac826879","period_label":"2025/2","scheduled_date":"2025-07-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:d5ab3177aadda88618991df4"]},{"legacy_source_key":"legacy-klima-xlsx:maintenance:f8064a8b7b02b10b30f846f6","period_label":"2024/1","scheduled_date":"2024-01-01","installation_legacy_source_keys":["legacy-klima-xlsx:installation:5419ebe2e27caf11a386c764","legacy-klima-xlsx:installation:91b6f3529b69adef7ce2f686"]}]$legacy_maintenance$::jsonb) as e(
  legacy_source_key text,
  period_label text,
  scheduled_date date,
  installation_legacy_source_keys jsonb
);

-- Before: planned changes.
select 'same_day_duplicate_groups_to_fix' as check_name, count(*)::bigint as count_value from _legacy_same_day_fixes
union all
select 'same_day_duplicate_appointments_to_hide', coalesce(sum(jsonb_array_length(duplicate_legacy_source_keys)), 0)::bigint from _legacy_same_day_fixes
union all
select 'maintenance_events_to_upsert', count(*)::bigint from _legacy_maintenance_events
union all
select 'maintenance_links_to_upsert', coalesce(sum(jsonb_array_length(installation_legacy_source_keys)), 0)::bigint from _legacy_maintenance_events;

update public.appointments a
set notes = concat_ws(chr(10), nullif(a.notes, ''), 'legacy_merged_same_day_source_rows:' || f.source_rows::text),
    updated_at = now()
from _legacy_same_day_fixes f
where a.legacy_source_key = f.canonical_legacy_source_key
  and coalesce(a.notes, '') not like '%legacy_merged_same_day_source_rows:%';

with duplicate_keys as (
  select
    f.canonical_legacy_source_key,
    jsonb_array_elements_text(f.duplicate_legacy_source_keys) as duplicate_legacy_source_key
  from _legacy_same_day_fixes f
)
update public.appointments a
set notes = concat_ws(chr(10), nullif(a.notes, ''), 'legacy_merged_into:' || d.canonical_legacy_source_key),
    updated_at = now()
from duplicate_keys d
where a.legacy_source_key = d.duplicate_legacy_source_key
  and coalesce(a.notes, '') not like '%legacy_merged_into:%';

create temp table _legacy_canonical_quotes on commit drop as
select
  f.canonical_legacy_source_key,
  f.items,
  a.id as appointment_id,
  coalesce(q_by_id.id, q_by_appointment.id) as quote_id,
  a.workspace_id
from _legacy_same_day_fixes f
join public.appointments a on a.legacy_source_key = f.canonical_legacy_source_key
left join public.quotes q_by_id on q_by_id.id = a.quote_id
left join public.quotes q_by_appointment on q_by_appointment.appointment_id = a.id;

update public.appointments a
set quote_id = c.quote_id,
    updated_at = now()
from _legacy_canonical_quotes c
where a.id = c.appointment_id
  and c.quote_id is not null
  and a.quote_id is distinct from c.quote_id;

delete from public.quote_items qi
using _legacy_canonical_quotes c
where c.quote_id is not null
  and qi.quote_id = c.quote_id;

insert into public.quote_items (
  quote_id,
  product_name,
  description,
  quantity,
  unit_price,
  total_price,
  workspace_id
)
select
  c.quote_id,
  item.name,
  'legacy-klima-xlsx|install_price=0|same_day_merged',
  greatest(1, item.quantity),
  0,
  0,
  c.workspace_id
from _legacy_canonical_quotes c
cross join lateral jsonb_to_recordset(c.items) as item(name text, quantity numeric)
where c.quote_id is not null;

with first_install as (
  select distinct on (e.legacy_source_key)
    e.legacy_source_key,
    e.period_label,
    e.scheduled_date,
    i.customer_id,
    i.address,
    i.workspace_id,
    i.created_by
  from _legacy_maintenance_events e
  cross join lateral jsonb_array_elements_text(e.installation_legacy_source_keys) as keys(installation_legacy_source_key)
  join public.appointments i on i.legacy_source_key = keys.installation_legacy_source_key
  where coalesce(i.notes, '') not like '%legacy_merged_into:%'
  order by e.legacy_source_key, i.scheduled_date asc, i.created_at asc, i.id asc
)
insert into public.appointments (
  customer_id,
  quote_id,
  title,
  scheduled_date,
  scheduled_time,
  appointment_type,
  status,
  address,
  notes,
  created_by,
  legacy_source_key,
  created_at,
  updated_at,
  workspace_id
)
select
  fi.customer_id,
  null,
  'Regi karbantartas - ' || fi.period_label,
  fi.scheduled_date,
  '08:00',
  'maintenance',
  'Lezárva',
  fi.address,
  concat_ws(chr(10),
    'legacy_source_key:' || fi.legacy_source_key,
    'Excel imported maintenance half-year: ' || fi.period_label,
    'The source Excel did not contain an exact day, so this date is a technical marker.'
  ),
  fi.created_by,
  fi.legacy_source_key,
  (fi.scheduled_date::timestamp + time '08:00') at time zone 'Europe/Budapest',
  (fi.scheduled_date::timestamp + time '08:00') at time zone 'Europe/Budapest',
  fi.workspace_id
from first_install fi
on conflict (legacy_source_key) do update
set customer_id = excluded.customer_id,
    title = excluded.title,
    scheduled_date = excluded.scheduled_date,
    scheduled_time = excluded.scheduled_time,
    appointment_type = excluded.appointment_type,
    status = excluded.status,
    address = excluded.address,
    notes = excluded.notes,
    workspace_id = excluded.workspace_id,
    updated_at = now();

with link_rows as (
  select
    e.legacy_source_key as maintenance_legacy_source_key,
    keys.installation_legacy_source_key,
    'legacy-klima-xlsx:maintenance-link:' || substr(md5(e.legacy_source_key || '|' || keys.installation_legacy_source_key), 1, 24) as link_legacy_source_key
  from _legacy_maintenance_events e
  cross join lateral jsonb_array_elements_text(e.installation_legacy_source_keys) as keys(installation_legacy_source_key)
),
resolved as (
  select
    maintenance.id as maintenance_appointment_id,
    installation.id as installation_appointment_id,
    installation.customer_id,
    coalesce(maintenance.workspace_id, installation.workspace_id) as workspace_id,
    link_rows.link_legacy_source_key
  from link_rows
  join public.appointments maintenance on maintenance.legacy_source_key = link_rows.maintenance_legacy_source_key
  join public.appointments installation on installation.legacy_source_key = link_rows.installation_legacy_source_key
  where coalesce(installation.notes, '') not like '%legacy_merged_into:%'
)
insert into public.maintenance_appointment_items (
  maintenance_appointment_id,
  installation_appointment_id,
  customer_id,
  legacy_source_key,
  workspace_id
)
select
  maintenance_appointment_id,
  installation_appointment_id,
  customer_id,
  link_legacy_source_key,
  workspace_id
from resolved
on conflict (maintenance_appointment_id, installation_appointment_id) do update
set customer_id = excluded.customer_id,
    legacy_source_key = excluded.legacy_source_key,
    workspace_id = excluded.workspace_id;

-- Final safety net for live rows that became the same customer only after the legacy customer upsert.
create temp table _legacy_remaining_same_day_rows on commit drop as
with candidates as (
  select
    a.id,
    a.customer_id,
    a.scheduled_date,
    a.legacy_source_key,
    a.address,
    a.notes,
    a.created_at,
    a.updated_at,
    a.workspace_id,
    coalesce(q_by_id.id, q_by_appointment.id) as quote_id,
    coalesce(item_stats.item_count, 0) as item_count,
    coalesce(item_stats.total_quantity, 0) as total_quantity
  from public.appointments a
  left join public.quotes q_by_id on q_by_id.id = a.quote_id
  left join public.quotes q_by_appointment on q_by_appointment.appointment_id = a.id
  left join lateral (
    select count(*)::int as item_count, coalesce(sum(qi.quantity), 0)::numeric as total_quantity
    from public.quote_items qi
    where qi.quote_id = coalesce(q_by_id.id, q_by_appointment.id)
  ) item_stats on true
  where a.legacy_source_key like 'legacy-klima-xlsx:installation:%'
    and coalesce(a.notes, '') not like '%legacy_merged_into:%'
),
duplicate_groups as (
  select customer_id, scheduled_date
  from candidates
  group by customer_id, scheduled_date
  having count(*) > 1
)
select
  candidates.*,
  row_number() over (
    partition by candidates.customer_id, candidates.scheduled_date
    order by
      candidates.total_quantity desc,
      candidates.item_count desc,
      length(coalesce(candidates.address, '')) desc,
      candidates.created_at asc,
      candidates.id asc
  ) as merge_rank
from candidates
join duplicate_groups using (customer_id, scheduled_date);

create temp table _legacy_remaining_same_day_map on commit drop as
select
  duplicate_rows.id as duplicate_appointment_id,
  duplicate_rows.quote_id as duplicate_quote_id,
  duplicate_rows.legacy_source_key as duplicate_legacy_source_key,
  canonical_rows.id as canonical_appointment_id,
  canonical_rows.quote_id as canonical_quote_id,
  canonical_rows.legacy_source_key as canonical_legacy_source_key,
  canonical_rows.workspace_id as canonical_workspace_id
from _legacy_remaining_same_day_rows duplicate_rows
join _legacy_remaining_same_day_rows canonical_rows
  on canonical_rows.customer_id = duplicate_rows.customer_id
 and canonical_rows.scheduled_date = duplicate_rows.scheduled_date
 and canonical_rows.merge_rank = 1
where duplicate_rows.merge_rank > 1;

create temp table _legacy_remaining_same_day_items on commit drop as
with quote_sources as (
  select distinct
    canonical_appointment_id,
    canonical_quote_id,
    canonical_workspace_id,
    canonical_quote_id as source_quote_id
  from _legacy_remaining_same_day_map
  where canonical_quote_id is not null
  union
  select distinct
    canonical_appointment_id,
    canonical_quote_id,
    canonical_workspace_id,
    duplicate_quote_id as source_quote_id
  from _legacy_remaining_same_day_map
  where canonical_quote_id is not null
    and duplicate_quote_id is not null
)
select
  quote_sources.canonical_appointment_id,
  quote_sources.canonical_quote_id,
  quote_sources.canonical_workspace_id,
  item.product_name,
  min(item.description) as description,
  sum(item.quantity) as quantity,
  case
    when sum(item.quantity) > 0 then round(sum(item.total_price) / sum(item.quantity), 0)
    else max(item.unit_price)
  end as unit_price,
  sum(item.total_price) as total_price
from quote_sources
join public.quote_items item
  on item.quote_id = quote_sources.source_quote_id
where item.product_name is not null
  and btrim(item.product_name) <> ''
group by
  quote_sources.canonical_appointment_id,
  quote_sources.canonical_quote_id,
  quote_sources.canonical_workspace_id,
  item.product_name;

update public.appointments a
set notes = concat_ws(chr(10), nullif(a.notes, ''), 'legacy_merged_same_day_live_catchall:true'),
    updated_at = now()
from _legacy_remaining_same_day_map map
where a.id = map.canonical_appointment_id
  and coalesce(a.notes, '') not like '%legacy_merged_same_day_live_catchall:%';

update public.appointments a
set notes = concat_ws(chr(10), nullif(a.notes, ''), 'legacy_merged_into:' || map.canonical_legacy_source_key),
    updated_at = now()
from _legacy_remaining_same_day_map map
where a.id = map.duplicate_appointment_id
  and coalesce(a.notes, '') not like '%legacy_merged_into:%';

delete from public.quote_items qi
using _legacy_remaining_same_day_map map
where map.canonical_quote_id is not null
  and qi.quote_id = map.canonical_quote_id;

insert into public.quote_items (
  quote_id,
  product_name,
  description,
  quantity,
  unit_price,
  total_price,
  workspace_id
)
select
  canonical_quote_id,
  product_name,
  coalesce(nullif(description, ''), 'legacy-klima-xlsx|same_day_live_catchall'),
  greatest(1, quantity),
  coalesce(unit_price, 0),
  coalesce(total_price, 0),
  canonical_workspace_id
from _legacy_remaining_same_day_items;

update public.maintenance_appointment_items mai
set installation_appointment_id = map.canonical_appointment_id,
    workspace_id = coalesce(mai.workspace_id, map.canonical_workspace_id)
from _legacy_remaining_same_day_map map
where mai.installation_appointment_id = map.duplicate_appointment_id
  and not exists (
    select 1
    from public.maintenance_appointment_items existing
    where existing.maintenance_appointment_id = mai.maintenance_appointment_id
      and existing.installation_appointment_id = map.canonical_appointment_id
  );

delete from public.maintenance_appointment_items mai
using _legacy_remaining_same_day_map map
where mai.installation_appointment_id = map.duplicate_appointment_id;

-- After: expected result checks.
select 'same_day_hidden_duplicate_appointments' as check_name, count(*)::bigint as count_value
from public.appointments
where legacy_source_key like 'legacy-klima-xlsx:installation:%'
  and coalesce(notes, '') like '%legacy_merged_into:%'
union all
select 'same_day_visible_duplicate_groups', count(*)::bigint
from (
  select customer_id, scheduled_date
  from public.appointments
  where legacy_source_key like 'legacy-klima-xlsx:installation:%'
    and coalesce(notes, '') not like '%legacy_merged_into:%'
  group by customer_id, scheduled_date
  having count(*) > 1
) duplicates
union all
select 'legacy_klima_maintenance_appointments', count(*)::bigint
from public.appointments
where legacy_source_key like 'legacy-klima-xlsx:maintenance:%'
union all
select 'legacy_klima_maintenance_links', count(*)::bigint
from public.maintenance_appointment_items
where legacy_source_key like 'legacy-klima-xlsx:maintenance-link:%'
union all
select 'legacy_klima_maintenance_without_links', count(*)::bigint
from public.appointments a
where a.legacy_source_key like 'legacy-klima-xlsx:maintenance:%'
  and not exists (
    select 1 from public.maintenance_appointment_items mai
    where mai.maintenance_appointment_id = a.id
  );

commit;
