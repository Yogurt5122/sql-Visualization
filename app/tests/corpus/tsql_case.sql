SELECT
  CASE
    WHEN pay_amount >= 1000 THEN 'high'
    WHEN pay_amount >= 100 THEN 'mid'
    ELSE 'low'
  END AS amount_level,
  COUNT(*) AS cnt
FROM dbo.dwd_order
GROUP BY
  CASE
    WHEN pay_amount >= 1000 THEN 'high'
    WHEN pay_amount >= 100 THEN 'mid'
    ELSE 'low'
  END;
