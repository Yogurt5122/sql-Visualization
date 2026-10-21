SELECT
  channel_id,
  COUNT(*) FILTER (WHERE status = 'PAID') AS paid_cnt,
  SUM(pay_amount) FILTER (WHERE status = 'PAID') AS gmv
FROM dwd_order
WHERE dt >= DATE '2024-12-01'
GROUP BY channel_id
ORDER BY gmv DESC;
