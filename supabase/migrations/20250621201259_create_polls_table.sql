-- Create polls table
-- Migration: 001_create_polls_table
-- Description: Creates the initial polls table to store poll data

CREATE TABLE IF NOT EXISTS polls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_polls_updated_at 
  BEFORE UPDATE ON polls 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to read polls
CREATE POLICY "Allow public read access on polls" ON polls
  FOR SELECT USING (true);

-- Create policy to allow anyone to insert polls
CREATE POLICY "Allow public insert access on polls" ON polls
  FOR INSERT WITH CHECK (true);