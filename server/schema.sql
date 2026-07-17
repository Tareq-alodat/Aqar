-- =========================================
-- AQAR Platform — Core Schema (Phase 1)
-- Run this against x_app_db_t
-- =========================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- USERS ----------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('investor','company','individual_owner','financier','admin')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- COMPANIES ----------
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(150) NOT NULL,
  license_number VARCHAR(100),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- PROPERTIES ----------
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  property_type VARCHAR(20) NOT NULL CHECK (property_type IN ('house','land','apartment','investment')),
  listed_price NUMERIC(14,2) NOT NULL CHECK (listed_price > 0),
  area_sqm NUMERIC(10,2),
  expected_roi_percent NUMERIC(5,2),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  city VARCHAR(100),
  district VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','active','sold','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_properties_status ON properties(status);
CREATE INDEX idx_properties_city ON properties(city);
CREATE INDEX idx_properties_type ON properties(property_type);
CREATE INDEX idx_properties_owner ON properties(owner_id);

-- ---------- PROPERTY IMAGES ----------
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_property_images_property ON property_images(property_id);

-- ---------- OFFERS (Bids, ±10% enforced in application code) ----------
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_offers_property ON offers(property_id);
CREATE INDEX idx_offers_bidder ON offers(bidder_id);

-- ---------- SAVED PROPERTIES (interest/favorites) ----------
CREATE TABLE saved_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, property_id)
);

-- ---------- FINANCIERS ----------
CREATE TABLE financiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_name VARCHAR(150) NOT NULL,
  interest_rate_percent NUMERIC(5,2),
  max_term_months INT,
  is_approved BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------- FINANCING REQUESTS ----------
CREATE TABLE financing_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,
  financier_id UUID NOT NULL REFERENCES financiers(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- PRICE HISTORY ----------
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price NUMERIC(14,2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- DEAL ROOMS ----------
CREATE TABLE deal_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  financier_id UUID REFERENCES financiers(id),
  admin_id UUID REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deal_room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_room_id UUID NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- INVESTMENT SIMULATIONS ----------
CREATE TABLE investment_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  development_cost NUMERIC(14,2),
  expected_rent NUMERIC(14,2),
  calculated_roi_percent NUMERIC(6,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================
-- Done. Verify with: \dt
-- =========================================
