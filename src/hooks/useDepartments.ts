import { useState, useEffect } from 'react';

const STORAGE_KEY = 'dowod-departments';

const DEFAULT_DEPARTMENTS = [
  'Kasa główna',
  'Administracja',
  'Młodzież',
  'Dzieci',
  'Muzyka',
];

const loadDepartments = (): string[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error loading departments:', e);
  }
  return DEFAULT_DEPARTMENTS;
};

const saveDepartments = (departments: string[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
};

export const useDepartments = () => {
  const [departments, setDepartments] = useState<string[]>(loadDepartments);

  useEffect(() => {
    saveDepartments(departments);
  }, [departments]);

  const addDepartment = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !departments.includes(trimmed)) {
      setDepartments([...departments, trimmed]);
      return true;
    }
    return false;
  };

  const deleteDepartment = (name: string) => {
    setDepartments(departments.filter(d => d !== name));
  };

  const updateDepartment = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && !departments.includes(trimmed)) {
      setDepartments(departments.map(d => d === oldName ? trimmed : d));
    }
  };

  return {
    departments,
    addDepartment,
    deleteDepartment,
    updateDepartment,
  };
};
