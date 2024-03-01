/*
 * Twilio - Api
 *
 * This is the public Twilio REST API.
 *
 * The version of the OpenAPI document: 1.55.0
 * Contact: support@twilio.com
 * Generated by: https://openapi-generator.tech
 */


/// 
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum CallEnumUpdateStatus {
    #[serde(rename = "canceled")]
    Canceled,
    #[serde(rename = "completed")]
    Completed,

}

impl ToString for CallEnumUpdateStatus {
    fn to_string(&self) -> String {
        match self {
            Self::Canceled => String::from("canceled"),
            Self::Completed => String::from("completed"),
        }
    }
}

impl Default for CallEnumUpdateStatus {
    fn default() -> CallEnumUpdateStatus {
        Self::Canceled
    }
}




