SELECT d.dept_name, e.emp_name, NVL(e.bonus, 0) AS bonus
FROM dm_emp e, dm_dept d
WHERE e.dept_id(+) = d.dept_id
  AND e.status = 1
  AND ROWNUM <= 100
ORDER BY e.hire_date DESC;
