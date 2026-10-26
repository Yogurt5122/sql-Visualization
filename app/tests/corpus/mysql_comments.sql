-- 注释里也有分号；不应该切语句
SELECT
  order_id, /* 订单号; 别切 */
  'PAID;DONE' AS status_label
FROM t_demo_order
WHERE dt = '2024-12-01' -- 行尾注释;
  AND status = 'PAID';
