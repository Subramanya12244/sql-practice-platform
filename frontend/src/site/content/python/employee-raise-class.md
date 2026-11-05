---
id: PY-034
title: Employee Raise Class
slug: employee-raise-class
difficulty: Easy
category: fundamentals
skill: transformation
description: Model an employee record with a raise method.
topic: python-oop
concepts: class, __init__, methods, validation
time: O(1)
space: O(1)
minutes: 8
---

## Scenario

The payroll sync models each employee as an object so salary changes are applied in one place with validation.

## Problem

Write class `Employee(name, salary)`. Method `apply_raise(pct)` increases salary by pct percent, rounded to 2 decimals, and returns the new salary. A negative pct raises ValueError. Method `to_dict()` returns {'name': ..., 'salary': ...}.

## Objective

Build an Employee class whose raise method validates input and whose to_dict returns a row.

## Input format

Name string, salary number.

## Output format

Employee object.

## Constraints

- Salary unchanged on ValueError

## Examples

```
e = Employee('Ana', 1000); e.apply_raise(10)  ->  1100.0
e.to_dict()  ->  {'name': 'Ana', 'salary': 1100.0}
```

## Hints

- Store name and salary on self.
- Validate pct before changing state.

## Why it matters

Simple classes keep record rules in one place and make pipeline code easier to test. to_dict is how objects are turned back into rows for loading.

```task
{
  "id": "employee-raise-class",
  "title": "Employee Raise Class",
  "type": "python",
  "instructions": "Write class `Employee(name, salary)`. Method `apply_raise(pct)` increases salary by pct percent, rounded to 2 decimals, and returns the new salary. A negative pct raises ValueError. Method `to_dict()` returns {'name': ..., 'salary': ...}.",
  "starter": "class Employee:\n    def __init__(self, name, salary):\n        raise NotImplementedError\n\n    def apply_raise(self, pct):\n        raise NotImplementedError\n\n    def to_dict(self):\n        raise NotImplementedError\n",
  "solution": "class Employee:\n    def __init__(self, name, salary):\n        self.name = name\n        self.salary = salary\n\n    def apply_raise(self, pct):\n        if pct < 0:\n            raise ValueError('negative raise')\n        self.salary = round(self.salary * (1 + pct / 100), 2)\n        return self.salary\n\n    def to_dict(self):\n        return {'name': self.name, 'salary': self.salary}\n",
  "tests": "e = Employee('Ana', 1000)\nassert e.apply_raise(10) == 1100.0\nassert e.to_dict() == {'name': 'Ana', 'salary': 1100.0}\n",
  "hidden": "e = Employee('Bo', 500)\ntry:\n    e.apply_raise(-5)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert e.salary == 500\nassert e.apply_raise(0) == 500\nassert Employee('C', 333.33).apply_raise(3) == 343.33\n",
  "explanation": "The constructor stores state, and apply_raise validates before mutating so a bad call leaves the salary unchanged. to_dict exposes the record in row form."
}
```
