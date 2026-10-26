SELECT
  order_id,
  JSON_UNQUOTE(JSON_EXTRACT(ext_info, '$.coupon_code')) AS coupon_code,
  pay_amount
FROM t_demo_order
WHERE JSON_EXTRACT(ext_info, '$.channel') = '"app"'
  AND dt = '2024-12-01';
